const { contextBridge, ipcRenderer } = require('electron')

// Only these functions are visible to the page (safe bridge)
contextBridge.exposeInMainWorld('movieAPI', {
    searchMovies: (query) => ipcRenderer.invoke('search-movies', query),
    getDetails: (imdbID) => ipcRenderer.invoke('get-details', imdbID)
})