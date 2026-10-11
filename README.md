# PDF Kit

Aplicación Expo SDK 57 para organizar documentos PDF en iOS, Android y web. Interfaz en español adaptable al móvil y al escritorio.

## Funciones

- Importar uno o varios PDF sin un límite de tamaño impuesto por la aplicación.
- Unir documentos en el orden elegido, con la opción de insertar una hoja A4 en blanco entre cada documento, conservando los originales. Los archivos importados para unir son temporales y solo se guarda el resultado en la biblioteca.
- Reordenar, girar y eliminar páginas; insertar hojas A4 en blanco.
- Renombrar documentos y añadir texto sobre cada página.
- Capturar una fotografía con la cámara o seleccionar varias fotos de la galería; recortar cada imagen arrastrando bordes y esquinas, sin una proporción fija, antes de crear el PDF A4.
- Buscar, filtrar, marcar favoritos y guardar o compartir archivos.
- Navegar por pestañas de Inicio, Mis documentos, Herramientas y Favoritos: el encabezado y la navegación permanecen fijos, y cada sección conserva su búsqueda, filtros, vista y desplazamiento. La pestaña seleccionada se destaca en verde.
- Biblioteca persistente en el dispositivo; en web utiliza IndexedDB.
- Visor PDF dentro de la app en móvil y web, con navegación por páginas, zoom y ajuste al ancho.
- Vista previa del resultado antes de guardar, actualizada al cambiar texto, giros, orden o número de hojas.
- Biblioteca con miniaturas de la primera página: imágenes pequeñas, caché persistente por documento y generación de una en una. Añadir, eliminar o marcar favoritos conserva las miniaturas de los PDF que no cambian. En Expo Go se mantienen las miniaturas existentes y los documentos nuevos usan un icono para evitar el cierre al generar miniaturas.
- Editor en una pantalla independiente: guardar arriba, documento en el centro y tira horizontal de miniaturas abajo. Desde la tira se puede navegar, reordenar páginas con flechas y eliminar la seleccionada. El botón «Añadir» abre opciones para insertar una hoja en blanco, una foto de la cámara, imágenes de la galería o páginas de otro PDF después de la página seleccionada. Las fotos conservan el recorte libre y los documentos añadidos se guardan dentro del PDF editado.

Los archivos se procesan localmente, sin servidor ni subida a servicios externos. No incluye OCR, corrección automática de perspectiva ni sustitución del texto existente. Para escanear varias hojas con la cámara, captura cada hoja y une los documentos resultantes. Los PDF protegidos con contraseña deben desbloquearse antes de importarlos. Al reorganizar se crea un PDF nuevo: las firmas digitales no se conservan y los formularios interactivos requieren revisión.

## Desarrollo

Requiere Node.js 22.13 o posterior, o una versión LTS compatible con Expo SDK 57.

```sh
npm install
npm run start
npm run web
npm run lint
npm run typecheck
npm test
```

La cámara y los permisos se deben verificar en un móvil real. Los permisos están configurados mediante el plugin `expo-image-picker` en `app.json`.

El visor usa PDF.js empaquetado localmente y `react-native-webview`, incluido en Expo Go. No requiere abrir otra aplicación ni cargar el motor desde internet. El script `npm run build:viewer` regenera `src/generated/pdf-viewer.json` después de actualizar PDF.js. La vista previa mantiene el PDF original abierto y aplica la lista de páginas sin reconstruirlo al insertar, eliminar o reordenar. Reutiliza las miniaturas y solo dibuja la página seleccionada cuando cambia. Las notas se preparan por página; el PDF completo se genera al guardar. El funcionamiento del visor móvil debe verificarse también en iOS y Android reales.

En móvil, la biblioteca conserva referencias a los archivos y el visor lee las partes necesarias en bloques de 64 KB. Las peticiones que abarcan varios bloques se completan antes de entregarlas a PDF.js. El editor genera las miniaturas visibles en la tira inferior de una en una y conserva las ya creadas al navegar o desplazar la tira.

Guardar en el editor muestra un diálogo centrado con porcentaje y etapas de lectura, edición, escritura y actualización de la biblioteca. Mientras se guarda, se libera el visor. Las páginas reutilizan los recursos originales y el resultado móvil se escribe en bloques de 192 KB, sin crear un segundo archivo completo en memoria. Los cambios se publican como una nueva versión; el archivo anterior se conserva hasta que se actualiza el índice. Renombrar sin modificar páginas solo actualiza los metadatos.

La biblioteca pertenece al dispositivo o navegador actual. Borrar los datos del navegador o desinstalar la app elimina su biblioteca; exporta los PDF que quieras conservar.

## Organización

`src/app/` contiene las rutas de Expo Router. La interfaz reutilizable está en `src/components/`, el motor de PDF en `src/lib/pdf-engine.ts`, y la importación/digitalización en `src/lib/pdf.ts`. Los adaptadores `storage.ts` y `storage.web.ts` proporcionan persistencia y exportación por plataforma. `scripts/test-pdf.cjs` verifica el comportamiento real de los documentos generados.
