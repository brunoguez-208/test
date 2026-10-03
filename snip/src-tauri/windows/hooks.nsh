; Hooks del instalador NSIS de Snip (instalación por usuario → HKCU).
;
; 1. Entrada "Recortar con Snip" en el menú contextual de los .mp4
;    (HKCU\Software\Classes\SystemFileAssociations\.mp4\shell\SnipTrim).
; 2. "Abrir con": Tauri registra el ProgID Snip.mp4 vía bundle.fileAssociations,
;    pero su macro también pisa el programa predeterminado de .mp4. Acá lo
;    restauramos y dejamos a Snip solo en OpenWithProgids, para que aparezca en
;    "Abrir con" sin robarle el doble click al reproductor del usuario.

!define SNIP_PROGID "Snip.mp4"
!define SNIP_VERB_KEY "Software\Classes\SystemFileAssociations\.mp4\shell\SnipTrim"

!macro NSIS_HOOK_POSTINSTALL
  ; --- Restaurar el predeterminado de .mp4 que el macro de Tauri respaldó ---
  ReadRegStr $R0 HKCU "Software\Classes\.mp4" "${SNIP_PROGID}_backup"
  ${If} $R0 == "${SNIP_PROGID}"
    StrCpy $R0 ""
  ${EndIf}
  ${If} $R0 == ""
    DeleteRegValue HKCU "Software\Classes\.mp4" ""
  ${Else}
    WriteRegStr HKCU "Software\Classes\.mp4" "" "$R0"
  ${EndIf}
  WriteRegStr HKCU "Software\Classes\.mp4\OpenWithProgids" "${SNIP_PROGID}" ""
  WriteRegStr HKCU "Software\Classes\${SNIP_PROGID}" "FriendlyTypeName" "Video MP4"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".mp4" ""

  ; --- Menú contextual: "Recortar con Snip" ---
  WriteRegStr HKCU "${SNIP_VERB_KEY}" "" "Recortar con Snip"
  WriteRegStr HKCU "${SNIP_VERB_KEY}" "MUIVerb" "Recortar con Snip"
  WriteRegStr HKCU "${SNIP_VERB_KEY}" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr HKCU "${SNIP_VERB_KEY}\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  ; Avisar al Explorador que cambiaron las asociaciones (SHCNE_ASSOCCHANGED).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "${SNIP_VERB_KEY}"
  DeleteRegValue HKCU "Software\Classes\.mp4\OpenWithProgids" "${SNIP_PROGID}"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; APP_UNASSOCIATE de Tauri escribe el respaldo como predeterminado; si estaba
  ; vacío, quitamos el valor para no dejar un predeterminado en blanco.
  ReadRegStr $R0 HKCU "Software\Classes\.mp4" ""
  ${If} $R0 == ""
  ${OrIf} $R0 == "${SNIP_PROGID}"
    DeleteRegValue HKCU "Software\Classes\.mp4" ""
  ${EndIf}
  DeleteRegValue HKCU "Software\Classes\.mp4" "${SNIP_PROGID}_backup"
  DeleteRegKey /ifempty HKCU "Software\Classes\.mp4\OpenWithProgids"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
