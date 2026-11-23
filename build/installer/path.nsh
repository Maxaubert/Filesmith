;
; Filesmith on the per-user PATH (spec 7.2). The edit itself is path.ps1, which
; keeps REG_EXPAND_SZ and never truncates a long PATH. Only resources\cli goes
; on PATH: putting resources\bin there would shadow the user's own ffmpeg,
; magick and 7z.
;
; nsExec leaves "0" on success, the exit code on failure, or "error" or
; "timeout". A failed PATH edit never stops the install or uninstall: the app
; works without it. Nothing that inserts these macros reads $0 afterwards.
;
!include "WinMessages.nsh"

!define FILESMITH_PS '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli\path.ps1"'

!macro filesmithPathAdd
  nsExec::ExecToLog '${FILESMITH_PS} add "$INSTDIR\resources\cli"'
  Pop $0
  ${If} $0 != "0"
    DetailPrint "Could not add the filesmith command to PATH (path.ps1 result: $0)"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Filesmith is installed and works.$\r$\n$\r$\nBut the filesmith command could not be added to your PATH (result: $0).$\r$\n$\r$\nTo use it in a terminal, add this folder to your PATH by hand:$\r$\n$INSTDIR\resources\cli"
    ${EndIf}
  ${EndIf}
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro filesmithPathRemove
  nsExec::ExecToLog '${FILESMITH_PS} remove "$INSTDIR\resources\cli"'
  Pop $0
  ${If} $0 != "0"
    DetailPrint "Could not remove the filesmith command from PATH (path.ps1 result: $0)"
  ${EndIf}
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
