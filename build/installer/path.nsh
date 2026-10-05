;
; Filesmith on the per-user PATH (spec 7.2). The edit itself is path.ps1, which
; keeps REG_EXPAND_SZ and never truncates a long PATH. Only resources\cli goes
; on PATH: putting resources\bin there would shadow the user's own ffmpeg,
; magick and 7z.
;
!include "WinMessages.nsh"

!define FILESMITH_PS '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli\path.ps1"'

!macro filesmithPathAdd
  nsExec::ExecToLog '${FILESMITH_PS} add "$INSTDIR\resources\cli"'
  Pop $0
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro filesmithPathRemove
  nsExec::ExecToLog '${FILESMITH_PS} remove "$INSTDIR\resources\cli"'
  Pop $0
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
