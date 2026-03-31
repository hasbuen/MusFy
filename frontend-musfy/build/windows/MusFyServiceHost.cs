using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

namespace MusFy.ServiceHost
{
    public sealed class MusFyWindowsService : ServiceBase
    {
        private const string ServiceInternalName = "MusFyHostService";
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

            startInfo.EnvironmentVariables["HOST"] = "0.0.0.0";
            startInfo.EnvironmentVariables["PORT"] = "3001";
            startInfo.EnvironmentVariables["MUSFY_SERVICE_BOOT"] = "1";
            startInfo.EnvironmentVariables["MUSFY_SERVICE_MODE"] = "local-service";
            startInfo.EnvironmentVariables["MUSFY_FRONTEND_DIST"] = frontendDist;

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
                if (_backendProcess != null)
                {
                    _backendProcess.Dispose();
                }
                _backendProcess = null;
            }
        }

        private void Log(string message)
        {
            try
            {
                File.AppendAllText(_logPath, string.Format("[{0:yyyy-MM-dd HH:mm:ss}] {1}{2}", DateTime.Now, message, Environment.NewLine));
            }
            catch
            {
                // Ignora falha de log para nao derrubar o servico.
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
