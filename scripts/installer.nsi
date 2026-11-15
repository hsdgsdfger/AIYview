; AIYview 安装包（NSIS）
;
; 用法：
;   makensis /DAPP_VERSION=0.1.3 /DSRC=<win-unpacked 绝对路径> /DOUT=<输出 exe 绝对路径> scripts\installer.nsi
;
; 特点：单用户安装（RequestExecutionLevel user，不弹 UAC），默认装到 %LOCALAPPDATA%\Programs\AIYview，
; 建开始菜单 + 桌面快捷方式，写 HKCU 卸载项；卸载时可选择是否一并删除 %APPDATA%\aiyview 用户数据。

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef APP_VERSION
  !define APP_VERSION "0.1.3"
!endif
!ifndef SRC
  !error "缺少 /DSRC（win-unpacked 目录）"
!endif
!ifndef OUT
  !define OUT "AIYview-Setup.exe"
!endif

!define APP_NAME "AIYview"
!define APP_PUBLISHER "AIYview"
!define REG_UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\AIYview"
!define REG_APP "Software\AIYview"

Name "${APP_NAME}"
Caption "${APP_NAME} ${APP_VERSION} 安装向导"
BrandingText "${APP_NAME} ${APP_VERSION}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\AIYview"
InstallDirRegKey HKCU "${REG_APP}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
ShowInstDetails show
ShowUninstDetails show
XPStyle on

VIProductVersion "0.1.3.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} 安装程序"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "MIT License"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APP_NAME} ${APP_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "本地 ComfyUI / A1111 出图浏览器与分级筛选器。$\r$\n$\r$\n安装是单用户的，不需要管理员权限；默认装到：$LOCALAPPDATA\Programs\AIYview。$\r$\n$\r$\n你的图库与标记数据保存在 %APPDATA%\aiyview，卸载时可以选择保留。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\AIYview.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动 ${APP_NAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "AIYview" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  SetOverwrite try
  File /r "${SRC}\*.*"

  ; 快捷方式
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\AIYview.exe" "" "$INSTDIR\AIYview.exe" 0
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\AIYview.exe" "" "$INSTDIR\AIYview.exe" 0

  ; 注册表：安装位置 + 卸载信息
  WriteRegStr HKCU "${REG_APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REG_UNINST}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${REG_UNINST}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${REG_UNINST}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${REG_UNINST}" "DisplayIcon" "$INSTDIR\AIYview.exe"
  WriteRegStr HKCU "${REG_UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REG_UNINST}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${REG_UNINST}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${REG_UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${REG_UNINST}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${REG_UNINST}" "EstimatedSize" "$0"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  ; 先关掉可能还在跑的进程，避免文件占用删不掉
  nsExec::Exec 'taskkill /F /IM AIYview.exe'
  Sleep 800

  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$INSTDIR\Uninstall.exe"

  RMDir /r "$INSTDIR"

  DeleteRegKey HKCU "${REG_UNINST}"
  DeleteRegKey HKCU "${REG_APP}"

  ; 用户数据（索引库 + 缩略图缓存）单独询问，默认不删。
  ; 静默卸载（/S）时绝不弹窗、也绝不删数据——避免脚本化卸载误删整个图库。
  IfSilent keepData
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除用户数据（$APPDATA\aiyview：索引库、缩略图缓存、日志）？$\r$\n$\r$\n选择「否」只卸载程序，下次重装还能接着用原来的图库。" IDYES delData IDNO keepData
  delData:
    RMDir /r "$APPDATA\aiyview"
  keepData:
SectionEnd
