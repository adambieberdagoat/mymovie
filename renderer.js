// Helpers
const LIST_KEY = 'mymovie_watchlist'
const SUGGEST_KEY = 'mymovie_suggestions'
let editingId = null   // imdbID of the movie being edited

const $ = (id) => document.getElementById(id)
const loadData = (key) => JSON.parse(localStorage.getItem(key) || '[]')
const saveData = (key, data) => localStorage.setItem(key, JSON.stringify(data))

function say(element, text, type) {
    element.textContent = text
    element.className = 'message ' + (type || '')
}

// OMDb sends the text "N/A" when data is missing
const hasValue = (value) => value && value !== 'N/A'

// Navigation (DOM + events)
document.querySelectorAll('.nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'))
        btn.classList.add('active')
        $('discover').hidden = btn.dataset.page !== 'discover'
        $('watchlist').hidden = btn.dataset.page !== 'watchlist'
        if (btn.dataset.page === 'watchlist') renderWatchlist()
    })
})

// Movie cards
function renderMovies(movies) {
    const results = $('movieResults')
    results.replaceChildren()

    movies.forEach(function (movie) {
        const card = document.createElement('div')
        card.className = 'movie-card'

        if (hasValue(movie.Poster)) {
            const poster = document.createElement('img')
            poster.src = movie.Poster
            poster.alt = movie.Title + ' poster'
            card.appendChild(poster)
        }

        const title = document.createElement('h3')
        title.textContent = movie.Title
        card.appendChild(title)

        // Search results only have the year; suggested movies also have rating and genre
        const meta = document.createElement('p')
        meta.className = 'meta'
        let text = movie.Year
        if (hasValue(movie.imdbRating)) text += ' | IMDb ' + movie.imdbRating
        if (hasValue(movie.Genre)) text += ' | ' + movie.Genre
        meta.textContent = text
        card.appendChild(meta)

        const actions = document.createElement('div')
        actions.className = 'row'

        const detailsBtn = document.createElement('button')
        detailsBtn.textContent = 'Details'
        detailsBtn.className = 'secondary'
        detailsBtn.addEventListener('click', () => showDetails(movie.imdbID))

        const addBtn = document.createElement('button')
        addBtn.textContent = 'Add to watchlist'
        addBtn.addEventListener('click', () => addToWatchlist(movie))

        actions.append(detailsBtn, addBtn)
        card.appendChild(actions)
        results.appendChild(card)
    })
}

// API: search
$('searchForm').addEventListener('submit', async function (event) {
    event.preventDefault()
    const message = $('message')
    const button = event.target.querySelector('button[type="submit"]')

    $('movieResults').replaceChildren()
    say(message, 'Searching movies...')
    button.disabled = true

    try {
        const movies = await window.movieAPI.searchMovies($('movieSearch').value)
        if (movies.length === 0) {
            say(message, 'No movies found. Try another title.', 'warn')
            return
        }
        say(message, movies.length + ' movies found.', 'ok')
        renderMovies(movies)
    } catch (error) {
        say(message, error.message, 'error')
    } finally {
        button.disabled = false
    }
})

// API: details popup
async function showDetails(imdbID) {
    try {
        const d = await window.movieAPI.getDetails(imdbID)
        const body = $('detailsBody')
        body.replaceChildren()

        // Show every rating source OMDb returns (IMDb, Rotten Tomatoes, Metacritic)
        const ratings = (d.Ratings || []).map((r) => r.Source + ': ' + r.Value).join(' | ')

        const lines = [
            ['h3', d.Title + ' (' + d.Year + ')'],
            ['p', 'Genre: ' + d.Genre],
            ['p', 'Runtime: ' + d.Runtime + ' | Rated: ' + d.Rated],
            ['p', 'Ratings: ' + (ratings || 'Not available')],
            ['p', 'Director: ' + d.Director],
            ['p', 'Actors: ' + d.Actors],
            ['p', 'Awards: ' + d.Awards],
            ['p', 'Box office: ' + d.BoxOffice],
            ['p', d.Plot]
        ]
        lines.forEach(function (line) {
            const el = document.createElement(line[0])
            el.textContent = line[1]
            body.appendChild(el)
        })
        $('detailsDialog').showModal()
    } catch (error) {
        say($('message'), error.message, 'error')
    }
}
$('closeDetails').addEventListener('click', () => $('detailsDialog').close())

// SUGGESTION LOGIC (control statements)
// Turns the mood and time into rules the movies must pass
function buildRules(mood, time) {
    const rules = { genre: '', minRating: 6, maxRuntime: 999 }

    // 1) Mood decides the genre and the minimum IMDb rating
    switch (mood) {
        case 'happy':
            rules.genre = 'Comedy'
            rules.minRating = 6.5
            break
        case 'excited':
            rules.genre = 'Action'
            rules.minRating = 6.5
            break
        case 'romantic':
            rules.genre = 'Romance'
            rules.minRating = 6.5
            break
        case 'scared':
            rules.genre = 'Horror'
            rules.minRating = 6
            break
        case 'curious':
            rules.genre = 'Sci-Fi'
            rules.minRating = 7
            break
        case 'emotional':
            rules.genre = 'Drama'
            rules.minRating = 7.5
            break
    }

    // 2) Time available decides the longest runtime allowed
    if (time === 'short') {
        rules.maxRuntime = 90
    } else if (time === 'medium') {
        rules.maxRuntime = 130
    }

    return rules
}

// Checks one movie (with full details) against the rules
function movieFits(movie, rules) {
    const runtime = parseInt(movie.Runtime) || 0
    const rating = parseFloat(movie.imdbRating) || 0

    if (!hasValue(movie.Genre) || !movie.Genre.includes(rules.genre)) return false
    if (rating < rules.minRating) return false
    if (runtime === 0 || runtime > rules.maxRuntime) return false
    return true
}

$('suggestForm').addEventListener('submit', async function (event) {
    event.preventDefault()
    const word = $('suggestWord').value.trim()
    const rules = buildRules($('mood').value, $('timeAvailable').value)

    // Validation
    if (word.length < 3) {
        say($('message'), 'Enter a search word with at least 3 letters.', 'error')
        return
    }

    $('movieResults').replaceChildren()
    say($('message'), 'Finding movies for you...')

    try {
        const found = await window.movieAPI.searchMovies(word)

        // Load the full details of every result (genre, runtime and rating are only in the details)
        const settled = await Promise.allSettled(found.map((m) => window.movieAPI.getDetails(m.imdbID)))
        const detailed = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value)

        // Keep the movies that fit, best rated first
        const matches = detailed
            .filter((m) => movieFits(m, rules))
            .sort((a, b) => parseFloat(b.imdbRating) - parseFloat(a.imdbRating))

        // Fallback when nothing fits
        if (matches.length === 0) {
            say($('message'), 'No suitable movie found for "' + word + '". Try another word, mood or more time.', 'warn')
            return
        }

        say($('message'), matches.length + ' movie(s) match your mood and time.', 'ok')
        renderMovies(matches)

        // Store the suggestion in Local Storage (keep the latest 10)
        const history = loadData(SUGGEST_KEY)
        history.unshift({
            mood: $('mood').value,
            time: $('timeAvailable').value,
            titles: matches.map((m) => m.Title),
            date: new Date().toLocaleString()
        })
        saveData(SUGGEST_KEY, history.slice(0, 10))
        showLastSuggestion()
    } catch (error) {
        say($('message'), error.message, 'error')
    }
})

function showLastSuggestion() {
    const history = loadData(SUGGEST_KEY)
    if (history.length === 0) return
    $('lastSuggestion').textContent = 'Last suggestion (' + history[0].date + '): ' + history[0].titles.slice(0, 3).join(', ')
}

// CRUD: CREATE
async function addToWatchlist(movie) {
    const list = loadData(LIST_KEY)

    // Validation: no duplicates
    if (list.some((item) => item.id === movie.imdbID)) {
        say($('message'), movie.Title + ' is already in your watchlist.', 'warn')
        return
    }

    try {
        // Search results have no runtime, so load the details when needed
        const d = movie.Runtime ? movie : await window.movieAPI.getDetails(movie.imdbID)
        list.push({
            id: d.imdbID,
            title: d.Title,
            year: d.Year,
            poster: hasValue(d.Poster) ? d.Poster : '',
            rating: parseFloat(d.imdbRating) || 0,
            runtime: parseInt(d.Runtime) || 0,
            status: 'Planned',
            note: ''
        })
        saveData(LIST_KEY, list)
        updateBadge()
        say($('message'), d.Title + ' added to your watchlist.', 'ok')
    } catch (error) {
        say($('message'), 'Could not add the movie: ' + error.message, 'error')
    }
}

// CRUD: READ
function renderWatchlist() {
    const list = loadData(LIST_KEY)
    const container = $('watchlistItems')
    container.replaceChildren()
    $('planResult').replaceChildren()
    say($('planMessage'), '')

    if (list.length === 0) {
        say($('listMessage'), 'Your watchlist is empty. Add movies from the Discover page.', 'warn')
        return
    }
    say($('listMessage'), list.length + ' movie(s) saved.', 'ok')

    list.forEach(function (item) {
        const ticket = document.createElement('div')
        ticket.className = 'ticket' + (item.status === 'Watched' ? ' watched' : '')

        if (item.poster) {
            const img = document.createElement('img')
            img.src = item.poster
            img.alt = item.title + ' poster'
            ticket.appendChild(img)
        }

        const info = document.createElement('div')
        info.className = 'ticket-info'
        const title = document.createElement('h3')
        title.textContent = item.title + ' (' + item.year + ')'
        const meta = document.createElement('p')
        meta.className = 'meta'
        meta.textContent = item.status + ' | ' + (item.runtime ? item.runtime + ' min' : 'Runtime unknown') +
            ' | ' + (item.rating ? 'IMDb ' + item.rating.toFixed(1) : 'No rating')
        const note = document.createElement('p')
        note.textContent = item.note || 'No note yet.'
        info.append(title, meta, note)

        const actions = document.createElement('div')
        actions.className = 'ticket-actions'
        const editBtn = document.createElement('button')
        editBtn.textContent = 'Edit'
        editBtn.addEventListener('click', () => openEdit(item.id))
        const deleteBtn = document.createElement('button')
        deleteBtn.textContent = 'Delete'
        deleteBtn.className = 'danger'
        deleteBtn.addEventListener('click', () => deleteMovie(item.id))
        actions.append(editBtn, deleteBtn)

        ticket.append(info, actions)
        container.appendChild(ticket)
    })
}

// CRUD: UPDATE
function openEdit(id) {
    const item = loadData(LIST_KEY).find((m) => m.id === id)
    editingId = id
    $('editTitle').textContent = item.title
    $('editStatus').value = item.status
    $('editNote').value = item.note
    say($('editMessage'), '')
    $('editDialog').showModal()
}

$('editForm').addEventListener('submit', function (event) {
    event.preventDefault()
    const note = $('editNote').value.trim()

    // Validation
    if (note.length > 120) {
        say($('editMessage'), 'Note is too long (' + note.length + '/120 characters).', 'error')
        return
    }

    const list = loadData(LIST_KEY)
    const item = list.find((m) => m.id === editingId)
    item.status = $('editStatus').value
    item.note = note
    saveData(LIST_KEY, list)

    $('editDialog').close()
    renderWatchlist()
    say($('listMessage'), item.title + ' updated.', 'ok')
})
$('cancelEdit').addEventListener('click', () => $('editDialog').close())

// CRUD: DELETE
function deleteMovie(id) {
    const list = loadData(LIST_KEY)
    const item = list.find((m) => m.id === id)
    if (!confirm('Remove "' + item.title + '" from your watchlist?')) return

    saveData(LIST_KEY, list.filter((m) => m.id !== id))
    updateBadge()
    renderWatchlist()
    say($('listMessage'), item.title + ' removed.', 'ok')
}

// CALCULATION: viewing time planner
$('planForm').addEventListener('submit', function (event) {
    event.preventDefault()
    const hours = parseFloat($('hoursPerDay').value)
    const result = $('planResult')
    result.replaceChildren()

    // Validation + boundary cases
    if (isNaN(hours) || hours < 0.5 || hours > 24) {
        say($('planMessage'), 'Enter hours per day between 0.5 and 24.', 'error')
        return
    }
    const planned = loadData(LIST_KEY).filter((m) => m.status === 'Planned')
    if (planned.length === 0) {
        say($('planMessage'), 'No planned movies to calculate. Add some first.', 'warn')
        return
    }

    const totalMinutes = planned.reduce((sum, m) => sum + m.runtime, 0)
    const rated = planned.filter((m) => m.rating > 0)   // ignore movies without a rating
    const avgRating = rated.length ? rated.reduce((sum, m) => sum + m.rating, 0) / rated.length : 0
    const days = Math.ceil(totalMinutes / (hours * 60))

    const lines = [
        'Planned movies: ' + planned.length,
        'Total watch time: ' + Math.floor(totalMinutes / 60) + ' h ' + (totalMinutes % 60) + ' min',
        'Average IMDb rating: ' + (rated.length ? avgRating.toFixed(1) + ' / 10' : 'No ratings available'),
        'Days to finish at ' + hours + ' h/day: ' + days + ' day(s)'
    ]
    say($('planMessage'), 'Here is your plan.', 'ok')
    lines.forEach(function (text) {
        const li = document.createElement('li')
        li.textContent = text
        result.appendChild(li)
    })
})

// Start-up
function updateBadge() {
    $('countBadge').textContent = loadData(LIST_KEY).length
}

updateBadge()
showLastSuggestion()
say($('message'), 'Search for a title or use "Help me choose" to begin.')