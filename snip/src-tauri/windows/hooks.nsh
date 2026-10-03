; Hooks del instalador NSIS de Snip (instalación por usuario → HKCU).
;
; 1. Videos (.mp4 .mov .mkv .webm): Tauri registra los ProgID Snip.<ext> vía
;    bundle.fileAssociations, pero su macro también pisa el programa
;    predeterminado. Acá lo restauramos y dejamos a Snip solo en
;    OpenWithProgids: aparece en "Abrir con" sin robarle el doble click al
;    reproductor del usuario. Más la entrada "Editar con Snip" en el menú
;    contextual (SystemFileAssociations\.<ext>\shell\SnipEdit).
; 2. Proyectos (.snip): Snip SÍ queda como predeterminado (doble click abre el
;    proyecto), con su propio ícono (snip-file.ico).
; 3. Actualización desde Snip 1: se borra la vieja entrada "Recortar con Snip".

!define SNIP_PROJECT_PROGID "Snip.project"

!macro SNIP_RESTORE_DEFAULT EXT
  ReadRegStr $R0 HKCU "Software\Classes\.${EXT}" "Snip.${EXT}_backup"
  ${If} $R0 == "Snip.${EXT}"
    StrCpy $R0 ""
  ${EndIf}
  ${If} $R0 == ""
    DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
  ${Else}
    WriteRegStr HKCU "Software\Classes\.${EXT}" "" "$R0"
  ${EndIf}
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "Snip.${EXT}" ""
  WriteRegStr HKCU "Software\Classes\Snip.${EXT}\shell\open" "" "Editar con Snip"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""

  ; Menú contextual: "Editar con Snip" (y adiós al "Recortar con Snip" de la versión 1).
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\SnipTrim"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\SnipEdit" "" "Editar con Snip"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\SnipEdit" "MUIVerb" "Editar con Snip"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\SnipEdit" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\SnipEdit\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro SNIP_REMOVE_VIDEO EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\SnipEdit"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.${EXT}\shell\SnipTrim"
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "Snip.${EXT}"
!macroend

!macro SNIP_CLEAN_DEFAULT EXT
  ; APP_UNASSOCIATE de Tauri escribe el respaldo como predeterminado; si estaba
  ; vacío (o era Snip), quitamos el valor para no dejar un predeterminado roto.
  ReadRegStr $R0 HKCU "Software\Classes\.${EXT}" ""
  ${If} $R0 == ""
  ${OrIf} $R0 == "Snip.${EXT}"
    DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
  ${EndIf}
  DeleteRegValue HKCU "Software\Classes\.${EXT}" "Snip.${EXT}_backup"
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Snip 1 y la primera versión de Snip 2 dejaban FFmpeg suelto junto al .exe;
  ; ahora vive en ffmpeg\ (build "shared", con sus DLL).
  Delete "$INSTDIR\ffmpeg.exe"
  Delete "$INSTDIR\ffprobe.exe"
  Delete "$INSTDIR\FFMPEG-LICENSE.txt"
  !insertmacro SNIP_RESTORE_DEFAULT "mp4"
  !insertmacro SNIP_RESTORE_DEFAULT "mov"
  !insertmacro SNIP_RESTORE_DEFAULT "mkv"
  !insertmacro SNIP_RESTORE_DEFAULT "webm"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"

  ; Proyectos .snip: ícono propio y textos en castellano.
  WriteRegStr HKCU "Software\Classes\${SNIP_PROJECT_PROGID}\DefaultIcon" "" "$\"$INSTDIR\snip-file.ico$\",0"
  WriteRegStr HKCU "Software\Classes\${SNIP_PROJECT_PROGID}" "FriendlyTypeName" "Proyecto de Snip"
  WriteRegStr HKCU "Software\Classes\${SNIP_PROJECT_PROGID}\shell\open" "" "Abrir en Snip"
  WriteRegStr HKCU "Software\Classes\.snip" "Content Type" "application/x-snip-project"
  WriteRegStr HKCU "Software\Classes\.snip" "PerceivedType" "document"
  WriteRegStr HKCU "Software\Classes\.snip\OpenWithProgids" "${SNIP_PROJECT_PROGID}" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".snip" ""

  ; Avisar al Explorador que cambiaron las asociaciones (SHCNE_ASSOCCHANGED).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro SNIP_REMOVE_VIDEO "mp4"
  !insertmacro SNIP_REMOVE_VIDEO "mov"
  !insertmacro SNIP_REMOVE_VIDEO "mkv"
  !insertmacro SNIP_REMOVE_VIDEO "webm"
  DeleteRegValue HKCU "Software\Classes\.snip\OpenWithProgids" "${SNIP_PROJECT_PROGID}"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro SNIP_CLEAN_DEFAULT "mp4"
  !insertmacro SNIP_CLEAN_DEFAULT "mov"
  !insertmacro SNIP_CLEAN_DEFAULT "mkv"
  !insertmacro SNIP_CLEAN_DEFAULT "webm"
  ReadRegStr $R0 HKCU "Software\Classes\.snip" ""
  ${If} $R0 == ""
  ${OrIf} $R0 == "${SNIP_PROJECT_PROGID}"
    DeleteRegKey HKCU "Software\Classes\.snip"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
