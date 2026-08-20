;
; Filesmith setup, part three: the four screens.
;
; Each page is the same thing: an empty dialog, the canvas from video.nsh, and a
; timer. What differs is $Screen, which picks the overlay and decides what the
; clicks mean. There is not a single button control in this file.
;
;

; ---- page order --------------------------------------------------------------
!macro customWelcomePage
  Page custom filesmithWelcomeCreate filesmithPageLeave
!macroend

!macro customPageAfterChangeDir
  Page custom filesmithWhereCreate filesmithWhereLeave
  ; this lands immediately before MUI_PAGE_INSTFILES, which is the only way to
  ; hand that page a SHOW function without an earlier page swallowing it
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW filesmithCopyShow
!macroend

!macro customFinishPage
  Page custom filesmithDoneCreate filesmithDoneLeave
!macroend

; When the section ends, autoclose walks on to the finish page by itself: the
; Next button it would otherwise wait for has been hidden since .onGUIInit.
!macro customInstall
  SetAutoClose true
!macroend

; Filesmith installs for whoever runs it and has no other mode, so the "anyone who
; uses this computer / only me" page has nothing to ask. Answering it here makes
; it skip itself before it is ever drawn.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; ---- shared ------------------------------------------------------------------
Function filesmithPageStart
  ; A silent install still calls a custom page's creator, and nsDialogs::Show
  ; with nothing to show never returns: /S used to hang here forever. Abort in
  ; a creator means "skip this page", which is exactly right.
  ${If} ${Silent}
    Abort
  ${EndIf}
  !insertmacro HIDE_WIZARD_BUTTONS
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}
  Push $Dialog
  Call FilesmithCanvas
  Call FilesmithPickOverlay
  Call FilesmithDraw
  ${NSD_CreateTimer} FilesmithTick ${TICK}
FunctionEnd

Function filesmithPageLeave
  ${NSD_KillTimer} FilesmithTick
  Call FilesmithCanvasFree
FunctionEnd

; Filesmith gets a folder of its own wherever it is put: nobody means "empty your
; Documents folder into this" when they pick Documents.
Function filesmithOwnFolder
  StrLen $0 "${APP_FILENAME}"
  StrCpy $1 "$INSTDIR" "" -$0
  ${If} $1 != "${APP_FILENAME}"
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  ${EndIf}
FunctionEnd

; called from FilesmithClick, which is parsed before this file
Function FilesmithBrowse
  nsDialogs::SelectFolderDialog "Choose where Filesmith goes" "$INSTDIR"
  Pop $0
  ${If} $0 != error
    StrCpy $INSTDIR "$0"
    Call filesmithOwnFolder
  ${EndIf}
FunctionEnd

; ---- 1. welcome --------------------------------------------------------------
Function filesmithWelcomeCreate
  ${If} ${Silent}
    Abort
  ${EndIf}
  InitPluginsDir
  !insertmacro UNPACK_MEDIA
  StrCpy $Screen 0
  ; what the finish screen offers, and what it offers by default
  StrCpy $RunAfter 1
  StrCpy $WantMenu 1
  StrCpy $WantDesk 0
  Call filesmithPageStart
  nsDialogs::Show
FunctionEnd

; ---- 2. where it goes --------------------------------------------------------
Function filesmithWhereCreate
  StrCpy $Screen 1
  Call filesmithPageStart
  nsDialogs::Show
FunctionEnd

Function filesmithWhereLeave
  Call filesmithPageLeave
  Call filesmithOwnFolder
FunctionEnd

; ---- 3. copying --------------------------------------------------------------
; MUI owns this page, and the section runs on the script thread, so nothing can
; call back into script while files are being written. This screen therefore
; draws one frame and hands the motion over to the progress bar, which Windows
; paints for us.
Function filesmithCopyShow
  ${If} ${Silent}
    Return
  ${EndIf}
  FindWindow $R4 "#32770" "" $HWNDPARENT
  GetDlgItem $R5 $R4 1004   ; progress bar
  GetDlgItem $0 $R4 1006    ; status line, which prints nothing here
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $R4 1016    ; the log
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $R4 1027    ; "show details"
  ShowWindow $0 ${SW_HIDE}
  !insertmacro HIDE_WIZARD_BUTTONS

  ; MUI sizes this dialog from its own template, which is smaller than our window
  IntOp $R2 ${ART_W} * $Dpi
  IntOp $R2 $R2 / 96
  IntOp $R3 ${ART_H} * $Dpi
  IntOp $R3 $R3 / 96
  System::Call 'user32::SetWindowPos(p $R4, p 0, i 0, i 0, i $R2, i $R3, i 0x14)'

  StrCpy $Screen 2
  Push $R4
  Call FilesmithCanvas
  StrCpy $Frame 30          ; the frame the bloom looks best on
  Call FilesmithPickOverlay
  Call FilesmithDraw

  ; the progress bar: theme off, smooth on, Filesmith's indigo, sat on the drawn
  ; trough and raised above the canvas
  System::Call 'uxtheme::SetWindowTheme(p $R5, w "", w "")'
  System::Call 'user32::GetWindowLong(p $R5, i -16) i .r0'
  IntOp $0 $0 | 0x01        ; PBS_SMOOTH
  System::Call 'user32::SetWindowLong(p $R5, i -16, i $0)'
  SendMessage $R5 ${PBM_SETBKCOLOR} 0 0x3D2F2B
  SendMessage $R5 ${PBM_SETBARCOLOR} 0 0xD65B5B
  !insertmacro OAT COPY_TRACK
  System::Call 'user32::SetWindowPos(p $R5, p 0, i $R0, i $R1, i $R2, i $R3, i 0x10)'
FunctionEnd

; ---- 4. ready ----------------------------------------------------------------
Function filesmithDoneCreate
  StrCpy $Screen 3
  Call filesmithPageStart
  nsDialogs::Show
FunctionEnd

Function filesmithDoneLeave
  Call filesmithPageLeave

  ; The install section always writes the start menu shortcut, so declining it
  ; here means taking it back off; the desktop one is only ever ours to make.
  ${If} $WantMenu = 0
    Delete "$SMPROGRAMS\${PRODUCT_FILENAME}.lnk"
  ${EndIf}
  ${If} $WantDesk = 1
    CreateShortcut "$DESKTOP\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  ${EndIf}

  ${If} $RunAfter = 1
    ; Plain Exec, not StdUtils' run-as-user: setup asks for no elevation and
    ; never gets any, so it is already the user. PRODUCT_FILENAME rather than
    ; APP_EXECUTABLE_FILENAME, which is declared after this file parses.
    Exec '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
  ${EndIf}
FunctionEnd
