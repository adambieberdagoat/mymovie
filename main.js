require('dotenv').config()

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'MyMovie - Movie Plan Application',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    })
    win.loadFile('index.html')
}

// One helper for every OMDb request
async function omdb(params) {
    const key = process.env.OMDB_KEY
    if (!key) throw new Error('OMDb API key is missing. Check your .env file.')

    const url = new URL('https://www.omdbapi.com/')
    url.searchParams.set('apikey', key)
    Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value))

    let response
    try {
        response = await fetch(url)
    } catch (err) {
        throw new Error('Cannot reach OMDb. Check your internet connection.')
    }
    if (!response.ok) throw new Error(`OMDb request failed (status ${response.status}).`)

    const data = await response.json()
    // OMDb answers with Response:"False" and an Error message when something is wrong
    if (data.Response === 'False') {
        if (data.Error === 'Movie not found!') return null
        throw new Error(data.Error || 'Unknown OMDb error.')
    }
    return data
}

// Search by title
ipcMain.handle('search-movies', async (event, query) => {
    if (!query || !query.trim()) throw new Error('Please enter a movie title.')
    const data = await omdb({ s: query.trim(), type: 'movie' })
    return data ? data.Search : []
})

// Full details by imdbID (genre, runtime, ratings, actors, plot...)
ipcMain.handle('get-details', async (event, imdbID) => {
    if (!/^tt\d+$/.test(imdbID)) throw new Error('Invalid movie ID.')
    const data = await omdb({ i: imdbID, plot: 'short' })
    if (!data) throw new Error('Movie details not found.')
    return data
})

app.whenReady().then(createWindow)