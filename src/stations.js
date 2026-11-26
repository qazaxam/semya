// Станции. Порядок = порядок переключения «следующая / предыдущая».
// urls — основной адрес и запасные (только https: сайт на https, iPhone не пустит http).
// city/fm — подпись под названием. rb — имя для поиска свежего адреса в каталоге radio-browser,
// если все адреса не отвечают; rbState — область, чтобы не перепутать с одноимённой станцией.
// Проверено 26.11.2026: ✓ — поток отвечает; ? — нестандартный порт, проверить отсюда не удалось.

export const MAIN = [
  { id: 'powerturk', name: 'Power Türk', city: 'Стамбул', fm: '99.8', color: '#e5232b',
    urls: ['https://live.powerapp.com.tr/powerturk/abr/playlist.m3u8', // ✓
      'https://live.powerapp.com.tr/powerturk/abr/powerturk/128/playlist.m3u8'] },

  // ---- Амасья (и Мерзифон) ----
  { id: 'amasyafm', group: 'Амасья', name: 'Amasya FM', city: 'Амасья', fm: '95.0', color: '#2f7de1',
    urls: ['https://ozelip547.yayintescil.com/3405/stream', // ✓
      'https://ozelip547.yayintescil.com:3405/stream'] },
  { id: 'hayat', group: 'Амасья', name: 'Radyo Hayat', city: 'Амасья · Мерзифон', fm: '95.5', color: '#c2185b',
    urls: ['https://sslyayin.radyoyayini.com:7059/i'], rb: 'Radyo Hayat', rbState: 'amasya' }, // ?
  { id: 'radyo5', group: 'Амасья', name: 'Radyo 5', city: 'Мерзифон', fm: '96.3', color: '#7b1fa2',
    urls: ['https://sslyayin.radyoyayini.com:7062/stream'] }, // ?
  { id: 'silafm', group: 'Амасья', name: 'Sıla FM', city: 'Мерзифон', fm: '98.0', color: '#00897b',
    urls: ['https://radyo.yayin.com.tr:4164/stream/;'] }, // ?
  { id: 'esinti', group: 'Амасья', name: 'Esinti FM', city: 'Мерзифон', fm: '88.8', color: '#43a047',
    urls: ['https://stream.zeno.fm/yzg9n0sma8zuv'] }, // ✓

  // ---- Токат ----
  { id: 'radyotokat', group: 'Токат', name: 'Radyo Tokat', city: 'Токат', fm: '92.0', color: '#f4511e',
    urls: ['https://radyo.yayin.com.tr:5908/;'], rb: 'Radyo Tokat', rbState: 'tokat' }, // ?
  { id: 'extra', group: 'Токат', name: 'Radyo Extra', city: 'Токат', fm: '90.5', color: '#fb8c00',
    urls: ['https://radyoext.80.yayin.com.tr/stream'] }, // ✓
  { id: 'sinerji', group: 'Токат', name: 'Radyo Sinerji', city: 'Токат', fm: '98.9', color: '#8e24aa',
    urls: ['https://radio.guventechnology.com/9994/stream'] }, // ✓
  { id: 'togu', group: 'Токат', name: 'Radyo TOGÜ', city: 'Токат · университет', fm: '88.7', color: '#3949ab',
    urls: ['https://radyotogu.gop.edu.tr/stream'] }, // ✓
  { id: 'zile', group: 'Токат', name: 'Radyo Zile', city: 'Зиле', fm: '93.5', color: '#00acc1',
    urls: ['https://radyozile.ozelip.com/8114/stream'] }, // ✓
  { id: 'ozlem', group: 'Токат', name: 'Özlem FM', city: 'Эрбаа', fm: '101.0', color: '#d81b60',
    urls: ['https://radyo.yayin.com.tr:4100/stream'] }, // ?
  { id: 'yore', group: 'Токат', name: 'Yöre FM', city: 'Эрбаа', fm: '102.5', color: '#6d4c41',
    urls: ['https://radyo.yayindakiler.com:4082/stream/'] }, // ?

  // ---- Турхал ----
  { id: 'turhalfm', group: 'Турхал', name: 'Turhal FM', city: 'Турхал', fm: '101.0', color: '#e53935',
    urls: ['https://streamtr.turkiyeradyolari.com/15160/stream'] }, // ✓
  { id: 'turhalsuper', group: 'Турхал', name: 'Turhal Süper FM', city: 'Турхал', fm: '100.0', color: '#1e88e5',
    urls: ['https://streamtr.turkiyeradyolari.com/15126/stream'] }, // ✓
  { id: 'rota', group: 'Турхал', name: 'Rota FM', city: 'Турхал', fm: '103.0', color: '#fdd835',
    urls: ['https://radyo2.fkbs.com.tr:8028/stream'] }, // ?
];

// Папка «Популярные»: самые слушаемые станции Турции.
export const POPULAR = [
  { id: 'joyturk', name: 'Joy Türk', city: 'Стамбул', fm: '', color: '#ec407a',
    urls: ['https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_TURK_SC',
      'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_TURK_ITUNES.mp3'] },
  { id: 'kralfm', name: 'Kral FM', city: 'Стамбул', fm: '92.0', color: '#c62828',
    urls: ['https://dygedge2.radyotvonline.net/kralfm/playlist.m3u8'] },
  { id: 'kralpop', name: 'Kral Pop', city: 'Стамбул', fm: '94.8', color: '#ad1457',
    urls: ['https://dygedge.radyotvonline.net/kralpop/playlist.m3u8',
      'https://ssldyg.radyotvonline.com/smil/smil:kralpop.smil/playlist.m3u8'] },
  { id: 'superfm', name: 'Süper FM', city: 'Стамбул', fm: '90.8', color: '#1565c0',
    urls: ['https://playerservices.streamtheworld.com/api/livestream-redirect/SUPER_FM128AAC.aac'] },
  { id: 'metrofm', name: 'Metro FM', city: 'Стамбул', fm: '97.2', color: '#283593',
    urls: ['https://playerservices.streamtheworld.com/api/livestream-redirect/METRO_FM_SC'] },
  { id: 'fenomen', name: 'Radyo Fenomen', city: 'Стамбул', fm: '', color: '#6a1b9a',
    urls: ['https://live.radyofenomen.com/fenomen/128/icecast.audio'] },
  { id: 'fenomenturk', name: 'Fenomen Türk', city: 'Стамбул', fm: '', color: '#4a148c',
    urls: ['https://live.radyofenomen.com/fenomenturk/abr/playlist.m3u8'] },
  { id: 'slowturk', name: 'Slow Türk', city: 'Стамбул', fm: '95.4', color: '#5d4037',
    urls: ['https://stream.radyotvonline.net/hls/play/slowturk.m3u8'] },
  { id: 'bestfm', name: 'Best FM', city: 'Стамбул', fm: '98.4', color: '#00838f',
    urls: ['https://ssldyg.radyotvonline.com/best/bestfm.stream/playlist.m3u8'] },
  { id: 'alemfm', name: 'Alem FM', city: 'Стамбул', fm: '89.2', color: '#ef6c00',
    urls: ['https://turkmedya.radyotvonline.net/alemfmaac', 'https://alemfm.radyotvonline.net/alemfmaac'] },
  { id: 'damarturk', name: 'Damar Türk', city: 'Стамбул', fm: '97.0', color: '#b71c1c',
    urls: ['https://live.radyositesihazir.com/7000/stream'] },
  { id: 'radyo7', name: 'Radyo 7', city: 'Стамбул', fm: '104.6', color: '#2e7d32',
    urls: ['https://moondigitaledge.radyotvonline.net/radyo7/playlist.m3u8'] },
  { id: 'virgin', name: 'Virgin Radio', city: 'Стамбул', fm: '106.2', color: '#d50000',
    urls: ['https://playerservices.streamtheworld.com/api/livestream-redirect/VIRGIN_RADIOAAC.aac',
      'https://playerservices.streamtheworld.com/api/livestream-redirect/VIRGIN_RADIO_ITUNES.mp3'] },
  { id: 'kafa', name: 'Kafa Radyo', city: 'Стамбул', fm: '89.6', color: '#455a64',
    urls: ['https://moondigitaledge2.radyotvonline.net/kafaradyo/playlist.m3u8'] },
  { id: 'radyod', name: 'Radyo D', city: 'Стамбул', fm: '104.0', color: '#0277bd',
    urls: ['https://moondigitaledge2.radyotvonline.net/radyod/playlist.m3u8'] },
  { id: 'powerpop', name: 'Power Pop', city: 'Стамбул', fm: '101.0', color: '#f50057',
    urls: ['https://live.powerapp.com.tr/powerpop/abr/playlist.m3u8'] },
  { id: 'ptakustik', name: 'PowerTürk Akustik', city: 'интернет', fm: '', color: '#8d6e63',
    urls: ['https://listen.powerapp.com.tr/powerturkakustik/abr/playlist.m3u8'] },
  { id: 'ptslow', name: 'PowerTürk Slow', city: 'интернет', fm: '', color: '#795548',
    urls: ['https://listen.powerapp.com.tr/powerturkslow/mpeg/icecast.audio'] },
  { id: 'palnostalji', name: 'Pal Nostalji', city: 'Стамбул', fm: '', color: '#9e9d24',
    urls: ['https://moondigitaledge.radyotvonline.net/palnostalji/playlist.m3u8'] },
  { id: 'viva', name: 'Radyo Viva', city: 'Стамбул', fm: '', color: '#00695c',
    urls: ['https://radyoviva.radyotvonline.net/radyovivaaac', 'https://moondigitaledge.radyotvonline.net/radyoviva/playlist.m3u8'] },
  { id: 'parkfm', name: 'Park FM', city: 'Анкара', fm: '96.8', color: '#558b2f',
    urls: ['https://stream.netradyom.com/listen/parkfm/radio.mp3'] },
  { id: 'trtfm', name: 'TRT FM', city: 'Анкара', fm: '', color: '#0d47a1',
    urls: ['https://trt.radyotvonline.net/trtfm'] },
  { id: 'trtturku', name: 'TRT Türkü', city: 'Анкара', fm: '103.6', color: '#bf360c',
    urls: ['https://rd-trtturku.medya.trt.com.tr/master_128.m3u8'] },
  { id: 'trtnagme', name: 'TRT Nağme', city: 'Анкара', fm: '', color: '#4e342e',
    urls: ['https://rd-trtnagme.medya.trt.com.tr/master.m3u8'] },
  { id: 'trt1', name: 'TRT Radyo 1', city: 'Анкара', fm: '', color: '#1a237e',
    urls: ['https://trt.radyotvonline.net/trt1'] },
];

export const LISTS = {
  main: { title: 'Радио', stations: MAIN },
  popular: { title: 'Популярные', stations: POPULAR },
};
