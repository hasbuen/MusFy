using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.ServiceProcess;

namespace MusFy.ServiceHost
{
    public sealed class MusFyWindowsService : ServiceBase
    {
        private const string ServiceInternalName = "MusFyHostService";
        private const int DefaultPort = 3001;
        private const int PortScanWindow = 40;
        private Process _backendProcess;
        private string _logPath;

        public MusFyWindowsService()
        {
            ServiceName = ServiceInternalName;
            CanStop = true;
            CanShutdown = true;
            AutoLog = false;
        }

        protected override void OnStart(string[] args)
        {
            var installDir = AppDomain.CurrentDomain.BaseDirectory;
            var resourcesDir = Path.Combine(installDir, "resources");
            var runtimeNode = Path.Combine(resourcesDir, "runtime", "node.exe");
            var backendEntry = Path.Combine(resourcesDir, "backend-musfy", "server.js");
            var frontendDist = Path.Combine(resourcesDir, "frontend-dist");

            var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            var logDir = Path.Combine(programData, "MusFy", "logs");
            Directory.CreateDirectory(logDir);
            _logPath = Path.Combine(logDir, "service-host.log");

            Log("Iniciando wrapper do servico MusFy.");

            if (!File.Exists(runtimeNode))
            {
                throw new FileNotFoundException("Runtime Node nao encontrado.", runtimeNode);
            }

            if (!File.Exists(backendEntry))
            {
                throw new FileNotFoundException("Backend MusFy nao encontrado.", backendEntry);
            }

            var bindHost = "0.0.0.0";
            var rendererHost = "127.0.0.1";
            var port = FindAvailablePort(DefaultPort);
            Log(string.Format("Porta selecionada para o backend: {0}", port));

            var startInfo = new ProcessStartInfo
            {
                FileName = runtimeNode,
                Arguments = string.Format("\"{0}\"", backendEntry),
                WorkingDirectory = Path.GetDirectoryName(backendEntry) ?? installDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };

            startInfo.EnvironmentVariables["HOST"] = bindHost;
            startInfo.EnvironmentVariables["PORT"] = port.ToString();
            startInfo.EnvironmentVariables["MUSFY_SERVICE_BOOT"] = "1";
            startInfo.EnvironmentVariables["MUSFY_SERVICE_MODE"] = "local-service";
            startInfo.EnvironmentVariables["MUSFY_FRONTEND_DIST"] = frontendDist;
            startInfo.EnvironmentVariables["NODE_PATH"] = Path.Combine(resourcesDir, "backend-musfy", "dependencies");

            _backendProcess = new Process
            {
                StartInfo = startInfo,
                EnableRaisingEvents = true
            };

            _backendProcess.OutputDataReceived += (_, eventArgs) =>
            {
                if (!string.IsNullOrWhiteSpace(eventArgs.Data))
                {
                    Log("[stdout] " + eventArgs.Data);
                }
            };

            _backendProcess.ErrorDataReceived += (_, eventArgs) =>
            {
                if (!string.IsNullOrWhiteSpace(eventArgs.Data))
                {
                    Log("[stderr] " + eventArgs.Data);
                }
            };

            _backendProcess.Exited += (_, __) =>
            {
                Log(string.Format("Processo backend finalizado com codigo {0}.", _backendProcess.ExitCode));
            };

            if (!_backendProcess.Start())
            {
                throw new InvalidOperationException("Falha ao iniciar o backend local do MusFy.");
            }

            _backendProcess.BeginOutputReadLine();
            _backendProcess.BeginErrorReadLine();
            WriteRuntimeState(rendererHost, port);
            Log(string.Format("Backend MusFy iniciado. PID={0}", _backendProcess.Id));
        }

        protected override void OnStop()
        {
            StopBackend();
        }

        protected override void OnShutdown()
        {
            StopBackend();
            base.OnShutdown();
        }

        private void StopBackend()
        {
            try
            {
                if (_backendProcess == null || _backendProcess.HasExited)
                {
                    Log("OnStop chamado sem processo backend ativo.");
                    DeleteRuntimeState();
                    return;
                }

                Log(string.Format("Encerrando backend MusFy. PID={0}", _backendProcess.Id));

                var killer = new ProcessStartInfo
                {
                    FileName = "taskkill.exe",
                    Arguments = string.Format("/PID {0} /T /F", _backendProcess.Id),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                using (var killProcess = Process.Start(killer))
                {
                    if (killProcess != null)
                    {
                        killProcess.WaitForExit(10000);
                    }
                }

                _backendProcess.WaitForExit(10000);
            }
            catch (Exception error)
            {
                Log("Falha ao encerrar backend: " + error);
            }
            finally
            {
                DeleteRuntimeState();
                if (_backendProcess != null)
                {
                    _backendProcess.Dispose();
                }
                _backendProcess = null;
            }
        }

        private static int FindAvailablePort(int preferredPort)
        {
            for (var port = preferredPort; port < preferredPort + PortScanWindow; port++)
            {
                if (IsPortAvailable(port))
                {
                    return port;
                }
            }

            return ReserveEphemeralPort();
        }

        private static bool IsPortAvailable(int port)
        {
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Any, port);
                listener.Server.ExclusiveAddressUse = true;
                listener.Start();
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                try
                {
                    if (listener != null)
                    {
                        listener.Stop();
                    }
                }
                catch
                {
                }
            }
        }

        private static int ReserveEphemeralPort()
        {
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Any, 0);
                listener.Start();
                return ((IPEndPoint)listener.LocalEndpoint).Port;
            }
            finally
            {
                try
                {
                    if (listener != null)
                    {
                        listener.Stop();
                    }
                }
                catch
                {
                }
            }
        }

        private static string ResolveRuntimeStatePath()
        {
            var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            var runtimeDir = Path.Combine(programData, "MusFy");
            Directory.CreateDirectory(runtimeDir);
            return Path.Combine(runtimeDir, "service-runtime.json");
        }

        private void WriteRuntimeState(string host, int port)
        {
            try
            {
                var content = string.Format(
                    "{{\"host\":\"{0}\",\"port\":{1},\"baseUrl\":\"http://{0}:{1}\",\"source\":\"external\",\"updatedAt\":\"{2:o}\"}}",
                    EscapeJson(host),
                    port,
                    DateTime.UtcNow
                );
                File.WriteAllText(ResolveRuntimeStatePath(), content);
            }
            catch (Exception error)
            {
                Log("Falha ao gravar runtime compartilhado: " + error.Message);
            }
        }

        private void DeleteRuntimeState()
        {
            try
            {
                var file = ResolveRuntimeStatePath();
                if (File.Exists(file))
                {
                    File.Delete(file);
                }
            }
            catch (Exception error)
            {
                Log("Falha ao limpar runtime compartilhado: " + error.Message);
            }
        }

        private static string EscapeJson(string value)
        {
            return (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private void Log(string message)
        {
            try
            {
                File.AppendAllText(_logPath, string.Format("[{0:yyyy-MM-dd HH:mm:ss}] {1}{2}", DateTime.Now, message, Environment.NewLine));
            }
            catch
            {
            }
        }
    }

    internal static class Program
    {
        private static void Main()
        {
            ServiceBase.Run(new ServiceBase[]
            {
                new MusFyWindowsService()
            });
        }
    }
}
