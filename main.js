const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const MIN_WIDTH = 320;
const MIN_HEIGHT = 160;

let win = null;
// Set while a resize handle is being dragged. Transparent windows on Windows
// have no native resize border, so we poll the cursor and resize ourselves.
let resize = null;

const boundsFile = () => path.join(app.getPath('userData'), 'window-bounds.json');

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
      b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
    return onScreen ? b : null;
  } catch {
    return null;
  }
}

function saveBounds() {
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify(win.getBounds()));
  } catch {
    // Losing the window position is not worth crashing over.
  }
}

function defaultBounds() {
  const { workArea: a } = screen.getPrimaryDisplay();
  const width = Math.min(900, a.width - 40);
  const height = 340;
  return { width, height, x: Math.round(a.x + (a.width - width) / 2), y: a.y + 24 };
}

function createWindow() {
  win = new BrowserWindow({
    ...(loadBounds() || defaultBounds()),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    title: 'Prompter',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'web', 'index.html'));

  // Dropping a file must load it as a script, never navigate the window to it.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('close', saveBounds);
  win.on('blur', stopResize);
  win.on('closed', () => { win = null; });
}

function stopResize() {
  if (!resize) return;
  clearInterval(resize.timer);
  resize = null;
}

function applyResize(state) {
  if (!win) return stopResize();
  const { edge, cursor, bounds } = state;
  const p = screen.getCursorScreenPoint();
  const dx = p.x - cursor.x;
  const dy = p.y - cursor.y;
  let { x, y, width, height } = bounds;

  if (edge.includes('r')) width = Math.max(MIN_WIDTH, bounds.width + dx);
  if (edge.includes('l')) {
    width = Math.max(MIN_WIDTH, bounds.width - dx);
    x = bounds.x + bounds.width - width;
  }
  if (edge.includes('b')) height = Math.max(MIN_HEIGHT, bounds.height + dy);
  if (edge.includes('t')) {
    height = Math.max(MIN_HEIGHT, bounds.height - dy);
    y = bounds.y + bounds.height - height;
  }

  const key = `${x},${y},${width},${height}`;
  if (key === state.last) return;
  state.last = key;
  win.setBounds({ x, y, width, height });
}

ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:close', () => win?.close());
ipcMain.on('win:always-on-top', (_e, on) => win?.setAlwaysOnTop(!!on, 'screen-saver'));
ipcMain.on('win:content-protection', (_e, on) => win?.setContentProtection(!!on));

ipcMain.on('win:resize-start', (_e, edge) => {
  if (!win || typeof edge !== 'string' || !/^[lrtb]{1,2}$/.test(edge)) return;
  stopResize();
  const state = { edge, cursor: screen.getCursorScreenPoint(), bounds: win.getBounds(), last: '' };
  state.timer = setInterval(() => applyResize(state), 16);
  resize = state;
});
ipcMain.on('win:resize-end', stopResize);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
