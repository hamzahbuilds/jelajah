// v0.44 starter templates (docs/30): ready-made plans anyone can start from.
// Each is a plan Draft (shared/draft.ts), so "Use this template" opens the
// normal New plan review: pick dates, then /plan/commit creates the trip and
// looks up every place on the map. Places are written as "Venue, Area" so
// the place search finds them. Times are suggestions in local time.
import type { Draft, DraftCategory } from './draft';
import type { PublicJourney } from './journey';

export interface TripTemplate {
  id: string;
  country: string;      // ISO alpha-2, for the flag
  pace: 'relaxed' | 'balanced' | 'packed';
  tags: string[];
  summary: string;
  draft: Draft;
}

type P = [time: string, title: string, place: string, category: DraftCategory, minutes: number, notes?: string];
const day = (title: string, places: P[]) => ({
  title,
  places: places.map(([start_time, t, place, category, duration_min, notes], i) => ({
    id: `${title.slice(0, 12)}-${i}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
    title: t, place, category, start_time, duration_min, ...(notes ? { notes } : {}),
  })),
});
const tpl = (id: string, country: string, pace: TripTemplate['pace'], tags: string[], summary: string, name: string, destination: string, days: ReturnType<typeof day>[]): TripTemplate => ({
  id, country, pace, tags, summary,
  draft: { name, destination, emoji: '', days, ideas: [] },
});

export const TEMPLATES: TripTemplate[] = [
  tpl('penang-food-weekend', 'MY', 'balanced', ['Food', 'Heritage', 'Weekend'],
    'Hawker breakfasts, George Town murals and a sunset on Penang Hill.',
    'Penang food weekend', 'Penang, Malaysia', [
      day('George Town heritage walk', [
        ['08:30', 'Roti canai breakfast', 'Roti Canai Transfer Road, George Town', 'food', 45],
        ['09:30', 'Armenian Street murals', 'Armenian Street, George Town', 'sightseeing', 90, 'Go early, before the heat and the crowds.'],
        ['11:30', 'Cheong Fatt Tze Blue Mansion tour', 'Cheong Fatt Tze Mansion, George Town', 'sightseeing', 60, 'Guided tours run at set times.'],
        ['13:00', 'Nasi kandar lunch', 'Hameediyah Restaurant, Lebuh Campbell, George Town', 'food', 60],
        ['15:00', 'Clan jetties', 'Chew Jetty, George Town', 'sightseeing', 60],
        ['19:30', 'Gurney Drive hawker dinner', 'Gurney Drive Hawker Centre, Penang', 'food', 90],
      ]),
      day('Hills and temples', [
        ['08:00', 'Dim sum breakfast', 'Tai Tong Restaurant, Lebuh Cintra, George Town', 'food', 60],
        ['09:30', 'Kek Lok Si Temple', 'Kek Lok Si Temple, Air Itam', 'sightseeing', 120],
        ['12:00', 'Air Itam laksa', 'Air Itam Market Laksa, Air Itam', 'food', 45],
        ['14:00', 'Penang Hill funicular', 'Penang Hill Lower Station, Air Itam', 'sightseeing', 180, 'Stay for sunset; buy the fast-lane ticket on weekends.'],
        ['19:30', 'Cendol and char kway teow', 'Penang Road Famous Teochew Chendul, George Town', 'food', 60],
      ]),
      day('Beach and goodbye', [
        ['09:00', 'Tropical Spice Garden', 'Tropical Spice Garden, Batu Ferringhi', 'sightseeing', 90],
        ['11:00', 'Batu Ferringhi beach', 'Batu Ferringhi Beach, Penang', 'sightseeing', 120],
        ['13:30', 'Seafood lunch', 'Batu Ferringhi, Penang', 'food', 75],
        ['16:00', 'Coffee at a shophouse café', 'Lebuh Chulia, George Town', 'food', 60],
      ]),
    ]),

  tpl('kl-city-break', 'MY', 'balanced', ['City', 'Food', 'Family'],
    'Twin Towers, Batu Caves and Jalan Alor at night, with easy LRT hops.',
    'Kuala Lumpur city break', 'Kuala Lumpur, Malaysia', [
      day('City centre', [
        ['09:00', 'Petronas Twin Towers skybridge', 'Petronas Twin Towers, Kuala Lumpur', 'sightseeing', 90, 'Book timed tickets ahead.'],
        ['10:45', 'KLCC Park', 'KLCC Park, Kuala Lumpur', 'sightseeing', 60],
        ['12:30', 'Lunch at Lot 10 Hutong', 'Lot 10 Hutong, Bukit Bintang', 'food', 60],
        ['14:30', 'Pavilion and Bukit Bintang', 'Pavilion Kuala Lumpur, Bukit Bintang', 'shopping', 120],
        ['19:30', 'Jalan Alor night food street', 'Jalan Alor, Bukit Bintang', 'food', 90],
      ]),
      day('Caves and old town', [
        ['08:00', 'Batu Caves', 'Batu Caves, Selangor', 'sightseeing', 120, 'Cover knees and shoulders; KTM Komuter goes direct.'],
        ['11:30', 'Banana leaf lunch', 'Brickfields, Kuala Lumpur', 'food', 60],
        ['13:30', 'Merdeka Square', 'Dataran Merdeka, Kuala Lumpur', 'sightseeing', 60],
        ['14:45', 'Central Market', 'Central Market, Kuala Lumpur', 'shopping', 75],
        ['16:15', 'Petaling Street', 'Petaling Street, Kuala Lumpur', 'shopping', 60],
        ['20:00', 'KL Tower sky deck', 'KL Tower, Kuala Lumpur', 'sightseeing', 75],
      ]),
      day('Gardens and mosques', [
        ['09:00', 'National Mosque', 'Masjid Negara, Kuala Lumpur', 'sightseeing', 45],
        ['10:00', 'Islamic Arts Museum', 'Islamic Arts Museum Malaysia, Kuala Lumpur', 'sightseeing', 120],
        ['12:30', 'KL Bird Park', 'KL Bird Park, Perdana Botanical Gardens', 'sightseeing', 120],
        ['15:30', 'Kampung Baru dinner', 'Kampung Baru, Kuala Lumpur', 'food', 90],
      ]),
    ]),

  tpl('singapore-family', 'SG', 'relaxed', ['Family', 'Theme parks', 'Gardens'],
    'Gardens by the Bay, Sentosa and the zoo, paced for kids, with MRT between stops.',
    'Singapore with the family', 'Singapore', [
      day('Marina Bay', [
        ['09:30', 'Gardens by the Bay domes', 'Gardens by the Bay, Singapore', 'sightseeing', 150],
        ['12:30', 'Satay by the Bay lunch', 'Satay by the Bay, Singapore', 'food', 60],
        ['14:00', 'ArtScience Museum', 'ArtScience Museum, Singapore', 'sightseeing', 120],
        ['17:30', 'Merlion Park', 'Merlion Park, Singapore', 'sightseeing', 45],
        ['19:45', 'Garden Rhapsody light show', 'Supertree Grove, Gardens by the Bay', 'sightseeing', 30, 'Free; shows at 7:45 and 8:45 pm.'],
      ]),
      day('Sentosa', [
        ['10:00', 'Universal Studios Singapore', 'Universal Studios Singapore, Sentosa', 'sightseeing', 360, 'Buy the Express pass on busy days.'],
        ['17:00', 'Siloso Beach', 'Siloso Beach, Sentosa', 'sightseeing', 90],
        ['19:00', 'Dinner at VivoCity', 'VivoCity, Singapore', 'food', 75],
      ]),
      day('Zoo day', [
        ['08:30', 'Breakfast with orangutans', 'Singapore Zoo, Mandai', 'food', 60, 'Book ahead.'],
        ['09:30', 'Singapore Zoo', 'Singapore Zoo, Mandai', 'sightseeing', 240],
        ['14:30', 'Bird Paradise', 'Bird Paradise, Mandai', 'sightseeing', 150],
        ['19:00', 'Night Safari', 'Night Safari, Mandai', 'sightseeing', 150],
      ]),
      day('Neighbourhoods', [
        ['09:00', 'Chinatown and Buddha Tooth Relic Temple', 'Buddha Tooth Relic Temple, Chinatown', 'sightseeing', 90],
        ['11:00', 'Maxwell Food Centre', 'Maxwell Food Centre, Singapore', 'food', 60, 'Tian Tian chicken rice queue moves fast.'],
        ['13:00', 'Kampong Glam and Haji Lane', 'Haji Lane, Kampong Glam', 'shopping', 120],
        ['16:00', 'Little India', 'Tekka Centre, Little India', 'sightseeing', 90],
      ]),
    ]),

  tpl('tokyo-first-timer', 'JP', 'packed', ['City', 'Culture', 'First time'],
    'Shibuya, Asakusa, a day in Hakone and the best of Tokyo food, on trains.',
    'Tokyo for first-timers', 'Tokyo, Japan', [
      day('Shibuya and Harajuku', [
        ['09:00', 'Meiji Jingu shrine', 'Meiji Jingu, Shibuya', 'sightseeing', 75],
        ['10:30', 'Takeshita Street', 'Takeshita Street, Harajuku', 'shopping', 60],
        ['12:00', 'Ramen lunch', 'Ichiran Shibuya, Shibuya', 'food', 45],
        ['13:30', 'Shibuya Crossing and Hachiko', 'Shibuya Crossing, Shibuya', 'sightseeing', 45],
        ['17:00', 'Shibuya Sky at sunset', 'Shibuya Sky, Shibuya Scramble Square', 'sightseeing', 90, 'Book sunset slots weeks ahead.'],
        ['19:30', 'Izakaya in Omoide Yokocho', 'Omoide Yokocho, Shinjuku', 'food', 90],
      ]),
      day('Old Tokyo', [
        ['08:00', 'Senso-ji temple', 'Senso-ji, Asakusa', 'sightseeing', 90, 'Earlier is calmer.'],
        ['10:00', 'Nakamise snacks', 'Nakamise-dori, Asakusa', 'food', 45],
        ['11:30', 'Tokyo Skytree', 'Tokyo Skytree, Sumida', 'sightseeing', 90],
        ['13:30', 'Monjayaki lunch', 'Tsukishima Monja Street, Chuo', 'food', 60],
        ['15:30', 'Ueno Park', 'Ueno Park, Taito', 'sightseeing', 90],
        ['17:30', 'Ameyoko market', 'Ameya-Yokocho, Ueno', 'shopping', 60],
      ]),
      day('Hakone day trip', [
        ['08:00', 'Romancecar to Hakone', 'Shinjuku Station, Tokyo', 'transport', 90, 'The Hakone Free Pass covers the loop.'],
        ['10:00', 'Hakone Open-Air Museum', 'Hakone Open-Air Museum, Hakone', 'sightseeing', 120],
        ['12:30', 'Owakudani ropeway and black eggs', 'Owakudani, Hakone', 'sightseeing', 90],
        ['14:30', 'Lake Ashi pirate ship', 'Togendai Port, Hakone', 'sightseeing', 60],
        ['16:00', 'Onsen', 'Tenzan Onsen, Hakone', 'other', 120],
      ]),
      day('Markets and modern Tokyo', [
        ['08:30', 'Tsukiji Outer Market breakfast', 'Tsukiji Outer Market, Chuo', 'food', 90],
        ['10:30', 'teamLab Planets', 'teamLab Planets, Toyosu', 'sightseeing', 120, 'Timed tickets; wear shorts or roll up trousers.'],
        ['13:30', 'Ginza', 'Ginza Six, Chuo', 'shopping', 120],
        ['18:00', 'Tokyo Tower', 'Tokyo Tower, Minato', 'sightseeing', 60],
      ]),
      day('Akihabara and goodbye', [
        ['10:00', 'Akihabara', 'Akihabara Electric Town, Chiyoda', 'shopping', 150],
        ['13:00', 'Tonkatsu lunch', 'Marugo, Akihabara', 'food', 60],
        ['14:30', 'Imperial Palace East Gardens', 'Imperial Palace East Gardens, Chiyoda', 'sightseeing', 90],
      ]),
    ]),

  tpl('bali-slow-week', 'ID', 'relaxed', ['Beach', 'Nature', 'Relaxed'],
    'Ubud rice terraces, temples and waterfalls, then slow beach days in the south.',
    'Bali slow week', 'Bali, Indonesia', [
      day('Arrive in Ubud', [
        ['15:00', 'Ubud Monkey Forest', 'Sacred Monkey Forest Sanctuary, Ubud', 'sightseeing', 90, 'Keep bags zipped.'],
        ['17:00', 'Ubud Palace and market', 'Ubud Palace, Ubud', 'sightseeing', 60],
        ['19:00', 'Balinese dinner', 'Jalan Hanoman, Ubud', 'food', 90],
      ]),
      day('Rice terraces and temples', [
        ['07:30', 'Tegallalang rice terraces', 'Tegallalang Rice Terrace, Gianyar', 'sightseeing', 120, 'Early for soft light and no crowds.'],
        ['10:30', 'Tirta Empul water temple', 'Tirta Empul, Tampaksiring', 'sightseeing', 90, 'Sarong provided.'],
        ['13:00', 'Lunch with a view', 'Kintamani, Bangli', 'food', 75],
        ['16:00', 'Campuhan Ridge walk', 'Campuhan Ridge Walk, Ubud', 'sightseeing', 75],
      ]),
      day('Waterfalls', [
        ['08:00', 'Tibumana waterfall', 'Tibumana Waterfall, Bangli', 'sightseeing', 75],
        ['10:00', 'Tukad Cepung waterfall', 'Tukad Cepung Waterfall, Bangli', 'sightseeing', 90],
        ['13:00', 'Babi guling lunch', 'Ubud, Bali', 'food', 60],
        ['15:30', 'Balinese massage', 'Ubud, Bali', 'other', 90],
      ]),
      day('South coast', [
        ['10:00', 'Move to Uluwatu', 'Uluwatu, Bali', 'transport', 120],
        ['14:00', 'Padang Padang beach', 'Padang Padang Beach, Uluwatu', 'sightseeing', 150],
        ['17:30', 'Uluwatu temple and Kecak dance', 'Uluwatu Temple, Pecatu', 'sightseeing', 120, 'Kecak at sunset; arrive by 5:30.'],
        ['20:00', 'Jimbaran seafood dinner', 'Jimbaran Beach, Bali', 'food', 90],
      ]),
      day('Beach day', [
        ['09:00', 'Melasti beach', 'Melasti Beach, Ungasan', 'sightseeing', 180],
        ['13:00', 'Beach club lunch', 'Uluwatu, Bali', 'food', 120],
        ['17:30', 'Sunset at Single Fin', 'Single Fin, Uluwatu', 'food', 120],
      ]),
    ]),

  tpl('langkawi-island-escape', 'MY', 'relaxed', ['Island', 'Nature', 'Family'],
    'Sky bridge, mangroves and island hopping, with long beach afternoons.',
    'Langkawi island escape', 'Langkawi, Malaysia', [
      day('Cable car and sky bridge', [
        ['09:30', 'Langkawi SkyCab and Sky Bridge', 'Langkawi Cable Car, Oriental Village', 'sightseeing', 180, 'Go on a clear morning; closes in high wind.'],
        ['13:00', 'Seven Wells waterfall', 'Telaga Tujuh Waterfall, Langkawi', 'sightseeing', 90],
        ['17:00', 'Pantai Cenang sunset', 'Pantai Cenang, Langkawi', 'sightseeing', 120],
        ['19:30', 'Seafood dinner', 'Pantai Cenang, Langkawi', 'food', 90],
      ]),
      day('Mangroves and islands', [
        ['09:00', 'Kilim mangrove boat tour', 'Kilim Karst Geoforest Park, Langkawi', 'sightseeing', 180, 'Eagle feeding and bat cave included on most tours.'],
        ['14:00', 'Island hopping', 'Pulau Dayang Bunting, Langkawi', 'sightseeing', 180],
        ['20:00', 'Night market', 'Langkawi Night Market, Langkawi', 'food', 90, 'Location changes by weekday.'],
      ]),
      day('Easy last day', [
        ['09:00', 'Tanjung Rhu beach', 'Tanjung Rhu Beach, Langkawi', 'sightseeing', 150],
        ['12:30', 'Lunch in Kuah', 'Kuah, Langkawi', 'food', 60],
        ['14:00', 'Duty-free shopping', 'Kuah Jetty Point, Langkawi', 'shopping', 90],
      ]),
    ]),
];

export const templateById = (id: string) => TEMPLATES.find(t => t.id === id) ?? null;
export const templatePlaces = (t: TripTemplate) => t.draft.days.reduce((n, d) => n + d.places.length, 0);

/** A template as a read-only schedule, for the same preview page shared journeys use. */
export function templateAsJourney(t: TripTemplate): PublicJourney {
  const end = (start: string, min: number) => {
    const [h, m] = start.split(':').map(Number), x = h * 60 + m + min;
    return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  };
  return {
    title: t.draft.name, destination: t.draft.destination, updatedAt: '',
    days: t.draft.days.map((d, i) => ({
      label: `Day ${i + 1}`, title: d.title, notes: [],
      stops: d.places.map(p => ({
        title: p.title, time: p.start_time ?? '', endTime: p.start_time && p.duration_min ? end(p.start_time, p.duration_min) : '',
        location: p.place ?? '', mode: '', duration: p.duration_min ? String(p.duration_min) : '',
      })),
    })),
  };
}

/** Any shared journey can be a starting point too: its days become a plan draft. */
export function journeyAsDraft(j: PublicJourney): Draft {
  const cat = (title: string): DraftCategory => /breakfast|lunch|dinner|food|cafe|café|market|makan|ramen|sushi/i.test(title) ? 'food'
    : /flight|train|bus|ferry|transfer|airport/i.test(title) ? 'transport' : /hotel|check.?in|stay/i.test(title) ? 'lodging' : 'sightseeing';
  return {
    name: j.title.slice(0, 80), destination: j.destination.slice(0, 120), emoji: '', ideas: [],
    days: j.days.slice(0, 14).map((d, i) => ({
      title: (d.title || `Day ${i + 1}`).slice(0, 80),
      places: d.stops.slice(0, 20).map((s, k) => ({
        id: `j${i}-${k}`, title: s.title.slice(0, 120), place: (s.location || s.title).slice(0, 160), category: cat(s.title),
        ...(/^\d{2}:\d{2}$/.test(s.time) ? { start_time: s.time } : {}),
      })),
    })),
  };
}
