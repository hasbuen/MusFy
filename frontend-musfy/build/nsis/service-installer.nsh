!include "LogicLib.nsh"
!define MUSFY_SERVICE_NAME "MusFyHostService"
!define MUSFY_LEGACY_SERVICE_NAME "MusFyService"

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
  !insertmacro StopMusFyService
!macroend

!macro customInstall
  !insertmacro DeleteMusFyService
  !insertmacro CreateMusFyService
!macroend

!macro customUnInstall
  !insertmacro StopMusFyService
  !insertmacro DeleteMusFyService
!macroend
