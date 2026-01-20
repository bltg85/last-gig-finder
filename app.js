// CORS proxy for Setlist.fm API
const CORS_PROXY = 'https://corsproxy.io/?';

// State
let settings = {
    apiKey: '',
    location: '',
    coords: null,
    maxDistance: 100
};

// DOM Elements
const setupSection = document.getElementById('setupSection');
const searchSection = document.getElementById('searchSection');
const resultsSection = document.getElementById('resultsSection');
const loading = document.getElementById('loading');
const noResults = document.getElementById('noResults');
const foundResult = document.getElementById('foundResult');
const artistInfo = document.getElementById('artistInfo');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    setupEventListeners();
});

function setupEventListeners() {
    // Distance slider
    const distanceSlider = document.getElementById('maxDistance');
    const distanceValue = document.getElementById('distanceValue');
    distanceSlider.addEventListener('input', () => {
        distanceValue.textContent = distanceSlider.value;
    });

    // Use my location button
    document.getElementById('useMyLocation').addEventListener('click', useMyLocation);

    // Save settings
    document.getElementById('saveSettings').addEventListener('click', saveSettings);

    // Edit settings
    document.getElementById('editSettings').addEventListener('click', () => {
        setupSection.style.display = 'block';
        searchSection.style.display = 'none';
        hideResults();
    });

    // Search
    document.getElementById('searchBtn').addEventListener('click', searchArtist);
    document.getElementById('artistSearch').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchArtist();
    });

    // Copy message
    document.getElementById('copyMessage').addEventListener('click', copyMessage);
}

function loadSettings() {
    const saved = localStorage.getItem('lastGigFinderSettings');
    if (saved) {
        settings = JSON.parse(saved);
        document.getElementById('apiKey').value = settings.apiKey || '';
        document.getElementById('userLocation').value = settings.location || '';
        document.getElementById('maxDistance').value = settings.maxDistance || 100;
        document.getElementById('distanceValue').textContent = settings.maxDistance || 100;

        if (settings.apiKey && settings.coords) {
            showSearchSection();
        }
    }
}

function saveSettings() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const location = document.getElementById('userLocation').value.trim();
    const maxDistance = parseInt(document.getElementById('maxDistance').value);

    if (!apiKey) {
        alert('Please enter your Setlist.fm API key');
        return;
    }

    if (!location && !settings.coords) {
        alert('Please enter a location or use your current position');
        return;
    }

    settings.apiKey = apiKey;
    settings.location = location;
    settings.maxDistance = maxDistance;

    // If we have a location name but no coords, geocode it
    if (location && !settings.coords) {
        geocodeLocation(location).then(coords => {
            if (coords) {
                settings.coords = coords;
                localStorage.setItem('lastGigFinderSettings', JSON.stringify(settings));
                showSearchSection();
            } else {
                alert('Could not find that location. Please try a different city name.');
            }
        });
    } else {
        localStorage.setItem('lastGigFinderSettings', JSON.stringify(settings));
        showSearchSection();
    }
}

function showSearchSection() {
    setupSection.style.display = 'none';
    searchSection.style.display = 'block';
    document.getElementById('locationSummary').textContent = `📍 ${settings.location || 'Your location'}`;
    document.getElementById('distanceSummary').textContent = `📏 ${settings.maxDistance} km radius`;
}

function useMyLocation() {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            settings.coords = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };

            // Reverse geocode to get city name
            const cityName = await reverseGeocode(settings.coords);
            if (cityName) {
                document.getElementById('userLocation').value = cityName;
                settings.location = cityName;
            } else {
                document.getElementById('userLocation').value = `${settings.coords.lat.toFixed(2)}, ${settings.coords.lng.toFixed(2)}`;
                settings.location = 'Your location';
            }
        },
        (error) => {
            alert('Unable to get your location: ' + error.message);
        }
    );
}

async function geocodeLocation(locationName) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}&limit=1`,
            { headers: { 'User-Agent': 'LastGigFinder/1.0' } }
        );
        const data = await response.json();
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon)
            };
        }
    } catch (error) {
        console.error('Geocoding error:', error);
    }
    return null;
}

async function reverseGeocode(coords) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lng}`,
            { headers: { 'User-Agent': 'LastGigFinder/1.0' } }
        );
        const data = await response.json();
        if (data && data.address) {
            return data.address.city || data.address.town || data.address.village || data.address.municipality;
        }
    } catch (error) {
        console.error('Reverse geocoding error:', error);
    }
    return null;
}

async function searchArtist() {
    const query = document.getElementById('artistSearch').value.trim();
    if (!query) {
        alert('Please enter an artist name');
        return;
    }

    hideResults();
    loading.style.display = 'block';

    try {
        // First, search for the artist
        const artistData = await searchArtistByName(query);
        if (!artistData) {
            loading.style.display = 'none';
            noResults.style.display = 'block';
            noResults.querySelector('p').textContent = '😢 Artist not found. Try a different spelling.';
            return;
        }

        // Then get their setlists
        const setlists = await getArtistSetlists(artistData.mbid);
        if (!setlists || setlists.length === 0) {
            loading.style.display = 'none';
            noResults.style.display = 'block';
            noResults.querySelector('p').textContent = '😢 No concerts found for this artist.';
            return;
        }

        // Find concerts within distance
        const nearbyConcerts = await findNearbyConcerts(setlists);

        loading.style.display = 'none';

        if (nearbyConcerts.length === 0) {
            noResults.style.display = 'block';
            noResults.querySelector('p').textContent = `😢 No concerts found within ${settings.maxDistance} km of your location.`;
            return;
        }

        // Show the most recent nearby concert
        displayResult(artistData.name, nearbyConcerts[0]);

    } catch (error) {
        console.error('Search error:', error);
        loading.style.display = 'none';
        noResults.style.display = 'block';
        noResults.querySelector('p').textContent = '❌ Error: ' + error.message;
    }
}

async function searchArtistByName(name) {
    const apiUrl = `https://api.setlist.fm/rest/1.0/search/artists?artistName=${encodeURIComponent(name)}&sort=relevance`;
    const response = await fetch(
        CORS_PROXY + encodeURIComponent(apiUrl),
        {
            headers: {
                'Accept': 'application/json',
                'x-api-key': settings.apiKey
            }
        }
    );

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('Invalid API key. Please check your Setlist.fm API key.');
        }
        throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    if (data.artist && data.artist.length > 0) {
        return data.artist[0];
    }
    return null;
}

async function getArtistSetlists(mbid) {
    const allSetlists = [];
    let page = 1;
    const maxPages = 10; // Limit to avoid too many requests

    while (page <= maxPages) {
        const apiUrl = `https://api.setlist.fm/rest/1.0/artist/${mbid}/setlists?p=${page}`;
        const response = await fetch(
            CORS_PROXY + encodeURIComponent(apiUrl),
            {
                headers: {
                    'Accept': 'application/json',
                    'x-api-key': settings.apiKey
                }
            }
        );

        if (!response.ok) break;

        const data = await response.json();
        if (!data.setlist || data.setlist.length === 0) break;

        allSetlists.push(...data.setlist);

        // Check if we have more pages
        if (page * data.itemsPerPage >= data.total) break;
        page++;

        // Small delay to be nice to the API
        await new Promise(r => setTimeout(r, 200));
    }

    return allSetlists;
}

async function findNearbyConcerts(setlists) {
    const nearbyConcerts = [];

    for (const setlist of setlists) {
        if (!setlist.venue || !setlist.venue.city) continue;

        const venueCity = setlist.venue.city;
        let venueCoords = null;

        // Try to get coordinates from the venue data
        if (venueCity.coords && venueCity.coords.lat) {
            venueCoords = {
                lat: venueCity.coords.lat,
                lng: venueCity.coords.long
            };
        } else {
            // Geocode the city
            const cityName = `${venueCity.name}, ${venueCity.country?.name || ''}`;
            venueCoords = await geocodeLocation(cityName);
            // Small delay for geocoding
            await new Promise(r => setTimeout(r, 100));
        }

        if (!venueCoords) continue;

        const distance = calculateDistance(
            settings.coords.lat, settings.coords.lng,
            venueCoords.lat, venueCoords.lng
        );

        if (distance <= settings.maxDistance) {
            nearbyConcerts.push({
                ...setlist,
                distance: Math.round(distance),
                venueCoords
            });
        }
    }

    // Sort by date (most recent first)
    nearbyConcerts.sort((a, b) => {
        const dateA = parseSetlistDate(a.eventDate);
        const dateB = parseSetlistDate(b.eventDate);
        return dateB - dateA;
    });

    return nearbyConcerts;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function toRad(deg) {
    return deg * (Math.PI / 180);
}

function parseSetlistDate(dateStr) {
    // Format: DD-MM-YYYY
    const parts = dateStr.split('-');
    return new Date(parts[2], parts[1] - 1, parts[0]);
}

function formatDate(dateStr) {
    const date = parseSetlistDate(dateStr);
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function calculateYearsAgo(dateStr) {
    const concertDate = parseSetlistDate(dateStr);
    const now = new Date();
    const diffTime = Math.abs(now - concertDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 30) {
        return { value: diffDays, label: diffDays === 1 ? 'day ago' : 'days ago' };
    } else if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        return { value: months, label: months === 1 ? 'month ago' : 'months ago' };
    } else {
        const years = Math.floor(diffDays / 365);
        return { value: years, label: years === 1 ? 'year ago' : 'years ago' };
    }
}

function displayResult(artistName, concert) {
    const yearsAgo = calculateYearsAgo(concert.eventDate);

    document.getElementById('artistName').textContent = artistName;
    document.getElementById('yearsAgoNumber').textContent = yearsAgo.value;
    document.getElementById('yearsLabel').textContent = yearsAgo.label;
    document.getElementById('concertVenue').textContent = concert.venue.name;
    document.getElementById('concertLocation').textContent =
        `${concert.venue.city.name}, ${concert.venue.city.country?.name || ''}`;
    document.getElementById('concertDate').textContent = formatDate(concert.eventDate);
    document.getElementById('concertDistance').textContent = `📍 ${concert.distance} km from you`;

    // Generate message
    const message = generateMessage(artistName, yearsAgo, concert);
    document.getElementById('messageText').value = message;

    artistInfo.style.display = 'block';
    foundResult.style.display = 'block';
}

function generateMessage(artistName, yearsAgo, concert) {
    const timeText = yearsAgo.value === 1
        ? `1 ${yearsAgo.label.replace(' ago', '')}`
        : `${yearsAgo.value} ${yearsAgo.label.replace(' ago', 's')}`;

    return `Hey ${artistName}! 👋

It's been ${yearsAgo.value} ${yearsAgo.label} since you played in ${concert.venue.city.name} (${formatDate(concert.eventDate)} at ${concert.venue.name}).

Time to come back! We miss you here! 🎸🎶

#ComeBack #WeWantYou`;
}

function copyMessage() {
    const messageText = document.getElementById('messageText');
    messageText.select();
    document.execCommand('copy');

    const btn = document.getElementById('copyMessage');
    const originalText = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => {
        btn.textContent = originalText;
    }, 2000);
}

function hideResults() {
    noResults.style.display = 'none';
    foundResult.style.display = 'none';
    artistInfo.style.display = 'none';
    loading.style.display = 'none';
}
