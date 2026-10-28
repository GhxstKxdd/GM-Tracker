import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { LocalStore } from './services/local-store'

const currentDirectory = __dirname
let store: LocalStore | undefined

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    title: 'Performance Tracker',
    backgroundColor: '#f4f6f5',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (!url.startsWith('file://') && !(devUrl && url.startsWith(devUrl))) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.performancetracker.desktop')
  nativeTheme.themeSource = 'light'
  const databasePath = join(app.getPath('userData'), 'performance-tracker-sales.sqlite')
  store = new LocalStore(databasePath)
  registerIpcHandlers(store)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => store?.close())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
