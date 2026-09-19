// Leaflet se carga vía <script> en geofences.html (no como módulo npm) para
// mantener el patrón de páginas ligeras; esta declaración solo evita que
// tsc se queje del global `L`.
declare const L: any;
