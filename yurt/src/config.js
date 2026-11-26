// Всё, что легко поменять, — здесь.
export const APP_NAME = 'Юрт';
export const HOMESERVER = 'https://matrix-client.matrix.org';
export const SPACE_NAME = 'Семья';   // пространство: его комнаты подключаются автоматически
export const WALL_ROOM_NAME = 'Стена';
export const DEVICE_NAME = 'Юрт — браузер';

// Фоновые уведомления: рассыльщик на Cloudflare (папка push-gateway) и его ОТКРЫТЫЙ ключ.
// Закрытый ключ хранится только в Cloudflare (секрет VAPID_JWK).
export const PUSH_GATEWAY = 'https://yurt-push.qazaxam.workers.dev';
export const VAPID_PUBLIC = 'BEnGgWO7rUsu8afz0qK7Wb0RB7H8TXLm91EB89sJPaIUTQtSB4xBTqUR5BR4txM8YCGKFF3u7hzhyBwePSQJEf4';

// Радио: [название, адрес потока (только https)]
export const STATIONS = [
  ['Power Türk', 'https://live.powerapp.com.tr/powerturk/abr/playlist.m3u8'],
  ['Joy Türk', 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_TURK_ITUNES.mp3'],
  ['Kral FM', 'https://dygedge2.radyotvonline.net/kralfm/playlist.m3u8'],
  ['Süper FM', 'https://playerservices.streamtheworld.com/api/livestream-redirect/SUPER2_SC'],
  ['Metro FM', 'https://playerservices.streamtheworld.com/api/livestream-redirect/METRO_FM_SC'],
  ['Radyo Fenomen', 'https://live.radyofenomen.com/fenomen/128/icecast.audio'],
  ['TRT Türkü', 'https://rd-trtturku.medya.trt.com.tr/master_128.m3u8'],
  ['Best FM', 'https://ssldyg.radyotvonline.com/best/bestfm.stream/playlist.m3u8'],
];
