// v0.42 public homepage copy (docs/28). Kept out of i18n.tsx because only the
// signed-out homepage uses it; same en / ms split.
const en = {
  metaTitle: 'Jelajah: plan group trips, map every stop, split costs',
  metaDesc: 'Turn an idea, a video or a blog post into a day-by-day trip plan. Invite the group, keep bookings together, get transit times and split costs. Free.',
  nav: { features: 'Features', how: 'How it works', discover: 'Discover', faq: 'FAQ', signIn: 'Sign in', start: 'Start planning', menu: 'Menu' },
  hero: {
    eyebrow: 'Group trip planner',
    title: 'The whole trip, planned in one place.',
    sub: 'Turn an idea, a TikTok or a blog post into a day-by-day plan with every stop on the map. Invite the group, keep bookings together and see who owes whom.',
    primary: 'Start planning',
    secondary: 'Browse journeys',
    note: 'Free. Sign in with Google.',
  },
  mock: {
    trip: 'Penang long weekend', dates: 'Fri 12 – Sun 14 Dec', day: 'Day 1',
    stops: [
      ['08:30', 'Roti canai at Transfer Road'],
      ['10:00', 'Armenian Street murals'],
      ['13:00', 'Kek Lok Si Temple'],
      ['19:30', 'Gurney Drive hawker centre'],
    ] as [string, string][],
    transit: 'Bus 204 · 25 min',
    owe: 'Aisha owes you RM 42',
    people: '4 going',
  },
  sources: { label: 'Plans from', items: ['A sentence', 'YouTube', 'TikTok', 'Instagram', 'Blogs', 'Screenshots'] },
  features: {
    eyebrow: 'Features',
    title: 'Everything a group trip needs, nothing it doesn’t.',
    items: [
      { icon: 'sparkles', title: 'Describe it, get a plan', text: 'Say where, when and who is coming. Jelajah asks a few questions, then drafts every day with times that make sense.' },
      { icon: 'link', title: 'Bring any link', text: 'Paste a YouTube, TikTok, Instagram or blog link, or add screenshots. The places it mentions land on your plan, pinned.' },
      { icon: 'train', title: 'Real transit times', text: 'Every stop on the map with walking, driving and public transport estimates across Malaysia, Singapore and Tokyo.' },
      { icon: 'users', title: 'Plan it together', text: 'Share one link. Everyone sees the group plan, and keeps a private plan of their own for side trips.' },
      { icon: 'files', title: 'Bookings and documents', text: 'Flights and hotels slot into the right day. Passports and tickets live in one folder, private when they should be.' },
      { icon: 'wallet', title: 'Split costs fairly', text: 'Log spending in any currency. Jelajah works out the balances and the fewest payments to settle up.' },
    ] as { icon: 'sparkles' | 'link' | 'train' | 'users' | 'files' | 'wallet'; title: string; text: string }[],
  },
  how: {
    eyebrow: 'How it works',
    title: 'From “we should go” to on the ground in three steps.',
    steps: [
      { title: 'Tell it the trip', text: 'Pick countries and dates, who is coming and the pace you like. Or paste a link you saved.' },
      { title: 'Shape it with the group', text: 'Invite everyone, move stops around, add bookings. Changes show up for the whole group.' },
      { title: 'Go, and settle up', text: 'Open the day on your phone, even offline. Log costs as you go and settle in a tap at the end.' },
    ],
  },
  compare: {
    eyebrow: 'Why Jelajah',
    title: 'One app instead of four.',
    cols: ['Jelajah', 'Itinerary app', 'Expense app', 'Group chat'],
    rows: [
      ['Day-by-day plan from a sentence', [true, 'some', false, false]],
      ['Import places from videos and blogs', [true, false, false, false]],
      ['Shared map with transit times', [true, true, false, false]],
      ['Bookings and documents in one place', [true, 'some', false, false]],
      ['Split costs and settle up', [true, false, true, false]],
      ['Works offline at no cost', [true, 'paid', true, true]],
    ] as [string, (boolean | 'some' | 'paid')[]][],
    some: 'Partly', paid: 'Paid plan', yes: 'Yes', no: 'No',
  },
  places: { eyebrow: 'Inspiration', title: 'Where to next?', sub: 'Start from a place, or from a plan another traveller shared.', open: 'See journeys', photo: 'Photo by', on: 'on Unsplash' },
  journeys: { title: 'Fresh from Discover', all: 'Browse all journeys' },
  faq: {
    title: 'Questions, answered',
    items: [
      ['Is Jelajah free?', 'Yes. Planning, the map, documents, splitting costs and offline use are free.'],
      ['How do I join?', 'Sign in with Google. Jelajah is invite-only while it is new, so ask a friend who uses it for an invite link, or open one you were sent.'],
      ['Who can see my trip?', 'Only the people you invite. If you choose to show a trip on Discover, others see the places, times and day titles, never names, money, documents or notes.'],
      ['Where do transit times work?', 'Public transport estimates cover all of Malaysia, Singapore and Tokyo. Elsewhere you get walking and driving times.'],
      ['Does it work without signal?', 'Install it to your home screen and the trips you have opened stay readable offline.'],
      ['Is it in Bahasa Malaysia?', 'Yes. Switch between English and Bahasa Malaysia at any time.'],
    ] as [string, string][],
  },
  cta: { title: 'Your next trip starts with one sentence.', sub: 'Tell Jelajah where you are going. It does the rest with you.', button: 'Start planning' },
  footer: { tagline: 'Group travel, sorted.', product: 'Product', privacy: 'Privacy', rights: 'Made in Malaysia.' },
  lang: 'Bahasa Malaysia',
};

const ms: typeof en = {
  metaTitle: 'Jelajah: rancang trip berkumpulan, peta setiap hentian, kongsi kos',
  metaDesc: 'Jadikan idea, video atau blog sebagai pelan trip harian. Jemput kumpulan, simpan tempahan bersama, dapatkan masa pengangkutan awam dan kongsi kos. Percuma.',
  nav: { features: 'Ciri', how: 'Cara guna', discover: 'Teroka', faq: 'Soalan lazim', signIn: 'Log masuk', start: 'Mula merancang', menu: 'Menu' },
  hero: {
    eyebrow: 'Perancang trip berkumpulan',
    title: 'Seluruh trip, dirancang di satu tempat.',
    sub: 'Jadikan idea, TikTok atau blog sebagai pelan harian dengan setiap hentian di peta. Jemput kumpulan, simpan tempahan bersama dan lihat siapa berhutang dengan siapa.',
    primary: 'Mula merancang',
    secondary: 'Lihat perjalanan',
    note: 'Percuma. Log masuk dengan Google.',
  },
  mock: {
    trip: 'Hujung minggu di Pulau Pinang', dates: 'Jum 12 – Ahd 14 Dis', day: 'Hari 1',
    stops: [
      ['08:30', 'Roti canai di Jalan Transfer'],
      ['10:00', 'Mural Lebuh Armenian'],
      ['13:00', 'Kuil Kek Lok Si'],
      ['19:30', 'Pusat penjaja Gurney Drive'],
    ],
    transit: 'Bas 204 · 25 min',
    owe: 'Aisha berhutang RM 42',
    people: '4 orang',
  },
  sources: { label: 'Pelan daripada', items: ['Satu ayat', 'YouTube', 'TikTok', 'Instagram', 'Blog', 'Tangkapan skrin'] },
  features: {
    eyebrow: 'Ciri',
    title: 'Semua yang trip berkumpulan perlukan.',
    items: [
      { icon: 'sparkles', title: 'Terangkan, dapat pelan', text: 'Beritahu ke mana, bila dan siapa ikut. Jelajah tanya beberapa soalan, kemudian merangka setiap hari dengan masa yang munasabah.' },
      { icon: 'link', title: 'Bawa apa-apa pautan', text: 'Tampal pautan YouTube, TikTok, Instagram atau blog, atau tambah tangkapan skrin. Tempat yang disebut masuk ke pelan, siap dipin.' },
      { icon: 'train', title: 'Masa pengangkutan sebenar', text: 'Setiap hentian di peta dengan anggaran berjalan, memandu dan pengangkutan awam di seluruh Malaysia, Singapura dan Tokyo.' },
      { icon: 'users', title: 'Rancang bersama', text: 'Kongsi satu pautan. Semua orang lihat pelan kumpulan, dan ada pelan peribadi sendiri untuk aktiviti sampingan.' },
      { icon: 'files', title: 'Tempahan dan dokumen', text: 'Penerbangan dan hotel masuk ke hari yang betul. Pasport dan tiket di satu folder, peribadi bila perlu.' },
      { icon: 'wallet', title: 'Kongsi kos dengan adil', text: 'Catat perbelanjaan dalam apa-apa mata wang. Jelajah kira baki dan bayaran paling sedikit untuk selesai.' },
    ],
  },
  how: {
    eyebrow: 'Cara guna',
    title: 'Daripada “jom pergi” ke destinasi dalam tiga langkah.',
    steps: [
      { title: 'Beritahu tentang trip', text: 'Pilih negara dan tarikh, siapa ikut dan rentak yang anda suka. Atau tampal pautan yang anda simpan.' },
      { title: 'Bentuk bersama kumpulan', text: 'Jemput semua, alih hentian, tambah tempahan. Perubahan dilihat oleh seluruh kumpulan.' },
      { title: 'Pergi, dan selesaikan', text: 'Buka hari itu di telefon, walaupun tanpa talian. Catat kos semasa trip dan selesaikan dengan satu ketikan.' },
    ],
  },
  compare: {
    eyebrow: 'Kenapa Jelajah',
    title: 'Satu aplikasi, bukan empat.',
    cols: ['Jelajah', 'Aplikasi jadual', 'Aplikasi belanja', 'Sembang kumpulan'],
    rows: [
      ['Pelan harian daripada satu ayat', [true, 'some', false, false]],
      ['Import tempat daripada video dan blog', [true, false, false, false]],
      ['Peta dikongsi dengan masa pengangkutan', [true, true, false, false]],
      ['Tempahan dan dokumen di satu tempat', [true, 'some', false, false]],
      ['Kongsi kos dan selesaikan', [true, false, true, false]],
      ['Guna tanpa talian secara percuma', [true, 'paid', true, true]],
    ],
    some: 'Sebahagian', paid: 'Pelan berbayar', yes: 'Ya', no: 'Tidak',
  },
  places: { eyebrow: 'Inspirasi', title: 'Ke mana seterusnya?', sub: 'Mula daripada tempat, atau pelan yang dikongsi pengembara lain.', open: 'Lihat perjalanan', photo: 'Foto oleh', on: 'di Unsplash' },
  journeys: { title: 'Terbaru di Teroka', all: 'Lihat semua perjalanan' },
  faq: {
    title: 'Soalan lazim',
    items: [
      ['Adakah Jelajah percuma?', 'Ya. Merancang, peta, dokumen, kongsi kos dan guna tanpa talian adalah percuma.'],
      ['Bagaimana mahu sertai?', 'Log masuk dengan Google. Jelajah hanya melalui jemputan buat masa ini, jadi minta pautan jemputan daripada rakan yang menggunakannya.'],
      ['Siapa boleh lihat trip saya?', 'Hanya orang yang anda jemput. Jika anda pilih untuk paparkan trip di Teroka, orang lain lihat tempat, masa dan tajuk hari, bukan nama, wang, dokumen atau nota.'],
      ['Di mana masa pengangkutan awam tersedia?', 'Anggaran pengangkutan awam meliputi seluruh Malaysia, Singapura dan Tokyo. Di tempat lain anda dapat masa berjalan dan memandu.'],
      ['Boleh guna tanpa liputan?', 'Pasang ke skrin utama dan trip yang pernah dibuka kekal boleh dibaca tanpa talian.'],
      ['Ada dalam Bahasa Malaysia?', 'Ya. Tukar antara English dan Bahasa Malaysia bila-bila masa.'],
    ],
  },
  cta: { title: 'Trip seterusnya bermula dengan satu ayat.', sub: 'Beritahu Jelajah ke mana anda pergi. Selebihnya dirancang bersama.', button: 'Mula merancang' },
  footer: { tagline: 'Perjalanan berkumpulan, tersusun.', product: 'Produk', privacy: 'Privasi', rights: 'Dibuat di Malaysia.' },
  lang: 'English',
};

export const HOME = { en, ms };
export type HomeCopy = typeof en;
