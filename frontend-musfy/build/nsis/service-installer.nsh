!include "LogicLib.nsh"
!define MUSFY_SERVICE_NAME "MusFyHostService"
!define MUSFY_LEGACY_SERVICE_NAME "MusFyService"

!macro KillMusFyProcesses
  DetailPrint "Encerrando processos do MusFy..."
  nsExec::ExecToLog 'taskkill /IM "MusFy.exe" /F /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM "MusFyServiceHost.exe" /F /T'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM "musfyservicehost.exe" /F /T'
  Pop $0
  Sleep 1200
!macroend

!macro RemoveMusFyFiles
  DetailPrint "Removendo atalhos e registros do MusFy..."

  SetShellVarContext current
  Delete "$DESKTOP\MusFy.lnk"
  Delete "$SMPROGRAMS\MusFy.lnk"
  Delete "$SMPROGRAMS\MusFy\MusFy.lnk"
  Delete "$SMPROGRAMS\MusFy\Desinstalar MusFy.lnk"
  RMDir /r "$SMPROGRAMS\MusFy"

  SetShellVarContext all
  Delete "$DESKTOP\MusFy.lnk"
  Delete "$SMPROGRAMS\MusFy.lnk"
  Delete "$SMPROGRAMS\MusFy\MusFy.lnk"
  Delete "$SMPROGRAMS\MusFy\Desinstalar MusFy.lnk"
  RMDir /r "$SMPROGRAMS\MusFy"

  DeleteRegKey HKCU "Software\MusFy"
  DeleteRegKey HKLM "Software\MusFy"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MusFy"
  DeleteRegKey HKLM "Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\MusFy"
!macroend

!macro BackupMusFyUserDataForUpdate
  ${If} ${isUpdated}
    DetailPrint "Protegendo biblioteca e contas antes da atualizacao..."
    RMDir /r "$PLUGINSDIR\musfy-user-data-backup"
    CreateDirectory "$PLUGINSDIR\musfy-user-data-backup"
    nsExec::ExecToLog 'cmd.exe /C if exist "%ProgramData%\MusFy" robocopy "%ProgramData%\MusFy" "$PLUGINSDIR\musfy-user-data-backup\ProgramData" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS'
    Pop $0
    nsExec::ExecToLog 'cmd.exe /C if exist "%APPDATA%\MusFy" robocopy "%APPDATA%\MusFy" "$PLUGINSDIR\musfy-user-data-backup\AppDataRoaming" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS'
    Pop $0
    nsExec::ExecToLog 'cmd.exe /C if exist "%LOCALAPPDATA%\MusFy" robocopy "%LOCALAPPDATA%\MusFy" "$PLUGINSDIR\musfy-user-data-backup\AppDataLocal" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS'
    Pop $0
  ${EndIf}
!macroend

!macro RestoreMusFyUserDataForUpdate
  ${If} ${isUpdated}
    DetailPrint "Restaurando biblioteca e contas preservadas..."
    nsExec::ExecToLog 'cmd.exe /C if exist "$PLUGINSDIR\musfy-user-data-backup\ProgramData" robocopy "$PLUGINSDIR\musfy-user-data-backup\ProgramData" "%ProgramData%\MusFy" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS'
    Pop $0
    nsExec::ExecToLog 'cmd.exe /C if exist "$PLUGINSDIR\musfy-user-data-backup\AppDataRoaming" robocopy "$PLUGINSDIR\musfy-user-data-backup\AppDataRoaming" "%APPDATA%\MusFy" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS'
    Pop $0
    nsExec::ExecToLog 'cmd.exe /C if exist "$PLUGINSDIR\musfy-user-data-backup\AppDataLocal" robocopy "$PLUGINSDIR\musfy-user-data-backup\AppDataLocal" "%LOCALAPPDATA%\MusFy" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS'
    Pop $0
  ${EndIf}
!macroend

!macro StopMusFyService
  DetailPrint "Parando o servico MusFy..."
  nsExec::ExecToLog 'sc.exe stop "${MUSFY_SERVICE_NAME}"'
  Pop $0
  Sleep 1200
  nsExec::ExecToLog 'sc.exe stop "${MUSFY_LEGACY_SERVICE_NAME}"'
  Pop $0
  Sleep 1200
!macroend

!macro DeleteMusFyService
  DetailPrint "Removendo registro antigo do servico MusFy..."
  nsExec::ExecToLog 'sc.exe delete "${MUSFY_SERVICE_NAME}"'
  Pop $0
  Sleep 1200
  nsExec::ExecToLog 'sc.exe delete "${MUSFY_LEGACY_SERVICE_NAME}"'
  Pop $0
  Sleep 1200
!macroend

!macro CreateMusFyService
  DetailPrint "Registrando o servico MusFy no Windows..."
  nsExec::ExecToLog 'sc.exe create "${MUSFY_SERVICE_NAME}" binPath= "\"$INSTDIR\MusFyServiceHost.exe\"" DisplayName= "MusFy Local Service" start= auto'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Nao foi possivel registrar o servico MusFy no Windows. Codigo: $0"
    Abort
  ${EndIf}

  nsExec::ExecToLog 'sc.exe description "${MUSFY_SERVICE_NAME}" "Servico local do MusFy para downloads, biblioteca e streaming na rede interna."'
  Pop $0

  nsExec::ExecToLog 'sc.exe failure "${MUSFY_SERVICE_NAME}" reset= 86400 actions= restart/60000/restart/60000/restart/60000'
  Pop $0

  nsExec::ExecToLog 'sc.exe config "${MUSFY_SERVICE_NAME}" start= delayed-auto'
  Pop $0

  DetailPrint "Iniciando o servico MusFy..."
  nsExec::ExecToLog 'sc.exe start "${MUSFY_SERVICE_NAME}"'
  Pop $0
!macroend

!macro customInit
  !insertmacro BackupMusFyUserDataForUpdate
  !insertmacro KillMusFyProcesses
  !insertmacro StopMusFyService
!macroend

!macro customInstall
  !insertmacro KillMusFyProcesses
  !insertmacro DeleteMusFyService
  !insertmacro RestoreMusFyUserDataForUpdate
  !insertmacro CreateMusFyService
!macroend

!macro customUnInstall
  !insertmacro KillMusFyProcesses
  !insertmacro StopMusFyService
  !insertmacro DeleteMusFyService
  ${IfNot} ${isUpdated}
    !insertmacro RemoveMusFyFiles
  ${Else}
    DetailPrint "Atualizacao detectada: dados do usuario preservados."
  ${EndIf}
!macroend
