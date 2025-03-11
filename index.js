const { chromium } = require('playwright');
const islive = require('isyoutubelive');

// Importar el ID del canal desde el JSON
const channels = require('./channelID.json'); // Asegurate de que el path sea correcto

// Definir el canal principal
const channelMain = 'olga'; // Aquí indicamos el nombre de la variable, no la ID
const channelId = channels[channelMain]; // Obtenemos la ID del canal desde el JSON

// Initialize viewer data array
let viewerData = [];

const checkLiveStream = async () => {
  let liveStreamUrl = null;
  
  while (!liveStreamUrl) {
    const res = await islive(channelId); // Usar la ID del canal desde el JSON
    
    if (res.is_live && res.url) {
      liveStreamUrl = res.url;
      console.log(`Transmisión en vivo encontrada: ${liveStreamUrl}`);
    } else {
      console.log('No hay transmisión en vivo. Intentando nuevamente...');
      await new Promise(resolve => setTimeout(resolve, 10000)); // Esperar 10 segundos antes de volver a intentar
    }
  }
  
  return liveStreamUrl;
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Interceptar todas las solicitudes de red
  await page.route('**/*', (route, request) => {
    route.continue();
  });

  let originalViewCount = null;

  // Escuchar todas las respuestas
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('updated_metadata?prettyPrint=false')) {
      try {
        const json = await response.json();
        if (json && json.actions && json.actions[0].updateViewershipAction) {
          const viewCountData = json.actions[0].updateViewershipAction.viewCount;
          originalViewCount = viewCountData.videoViewCountRenderer.originalViewCount;

          const timestamp = new Date().toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });

          console.log(` [${timestamp}] Número de espectadores YouTube: ${originalViewCount}`);
          
          // Store data in memory
          viewerData.push({ timestamp, originalViewCount });
          
          // Keep only the last 100 data points to prevent memory issues
          if (viewerData.length > 100) {
            viewerData.shift();
          }
        }
      } catch (error) {
        console.error('Error procesando la respuesta JSON:', error);
      }
    }
  });

  // Comprobar si hay una transmisión en vivo
  const liveStreamUrl = await checkLiveStream();

  // Navegar a la URL del video de YouTube
  await page.goto(liveStreamUrl);

  // Mantener el script ejecutándose indefinidamente
  await new Promise(() => {}); // Mantiene el script activo
})();
