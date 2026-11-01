/* סקרן: the page. It talks only to this site's /api, which keeps the keys and builds the prompts. */
(function () {
  'use strict';
  const D = document;

  /* ---------- helpers ---------- */
  const $ = (s, r) => (r || D).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rich = s => esc(s).replace(/==(.+?)==/g, '<mark>$1</mark>');
  const plain = s => String(s || '').replace(/==/g, '');
  const str = v => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()));
  const arr = v => (Array.isArray(v) ? v : []);
  const enc = encodeURIComponent;
  const qs = o => Object.keys(o).filter(k => o[k] != null && o[k] !== '').map(k => enc(k) + '=' + enc(o[k])).join('&');
  const safe = u => (typeof u === 'string' && /^https:\/\/[^\s"'<>\\]+$/.test(u) ? u : '');
  const hasHe = s => /[֐-׿]/.test(s || '');
  const fmt = sec => { const s = Math.max(0, Math.ceil(sec)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  /* write a tile only when its content changed, so a playing video or a focused button is left alone */
  const setHTML = (el, html) => { if (el && el._html !== html) { el.innerHTML = html; el._html = html; } };
  const ICON = {
    play: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 4.5v15L19.5 12z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="5" y="5" width="14" height="14" fill="currentColor"/></svg>'
  };
  const getJSON = (url, opts) => fetch(url, opts)
    .then(r => r.json().catch(() => ({ error: 'upstream_error' })))
    .catch(() => ({ error: 'network' }));

  /* ---------- course shape ---------- */
  const LEVELS = { all: { label: 'לכולם' }, kids: { label: 'ילדים' }, beginner: { label: 'מתחילים' }, advanced: { label: 'מתקדמים' } };
  const CHAPTERS = { 5: 3, 10: 4, 15: 5, 30: 7 };
  const PLANS = {
    5: [['feed', 3], ['play', 1], ['quiz', 1]],
    10: [['feed', 5], ['video', 2], ['play', 1], ['quiz', 2]],
    15: [['feed', 7], ['video', 3], ['play', 2], ['quiz', 3]],
    30: [['feed', 14], ['video', 4], ['podcast', 6], ['play', 2], ['quiz', 4]]
  };
  const TL_LABEL = { feed: 'הפיד', video: 'סרטון', podcast: 'פודקאסט', play: 'הפוגה', quiz: 'מבחן' };
  /* o = order when the grid becomes one column on a phone: pictures stay spread between the texts */
  const TILES = {
    feed: { label: 'הפיד', o: 1 }, img2: { label: 'איור', o: 2, img: true }, video: { label: 'סרטונים', o: 3 },
    ph1: { label: 'תמונה', o: 4, img: true }, riddle: { label: 'חידה', o: 5 }, img1: { label: 'איור', o: 6, img: true },
    quiz: { label: 'מבחן עצמי', o: 7 }, joke: { label: 'בדיחה', o: 8 }, ph2: { label: 'תמונה', o: 9, img: true },
    fact: { label: 'עובדה מפתיעה', o: 10 }, img3: { label: 'איור', o: 11, img: true }, podcast: { label: 'פודקאסט', o: 12 },
    spicy: { label: 'מידע פיקנטי', o: 13 }, ph3: { label: 'תמונה', o: 14, img: true }, song: { label: 'שיר', o: 15 },
    sources: { label: 'להעמקה', o: 16 }, notes: { label: 'ההערות שלי', o: 17 }
  };
  const COLS = {
    a: ['video', 'img1', 'riddle', 'joke', 'ph2', 'song'],
    main: ['feed', 'img2', 'quiz', 'ph1', 'notes'],
    b: ['podcast', 'fact', 'img3', 'spicy', 'ph3', 'sources']
  };
  const PENDING = {
    feed: 'כותבים את הפיד...', quiz: 'מנסחים שאלות...', video: 'מחפשים סרטונים...', fact: 'מחפשים עובדה מפתיעה...',
    riddle: 'ממציאים חידה...', joke: 'כותבים בדיחה...', podcast: 'מכינים פרק...', spicy: 'חופרים בפרטים...',
    song: 'מחפשים שיר שמתאים...', sources: 'אוספים מקורות...'
  };
  const KEYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
  const ERR = {
    not_configured: 'יצירת קורסים חדשים עוד לא הופעלה באתר הזה. בינתיים אפשר לראות את הקורס המוכן.',
    access_code: 'קוד הגישה חסר או לא נכון.',
    rate_limited: 'הגעתם למגבלת השימוש כרגע. אפשר לנסות שוב בעוד כמה דקות.',
    overloaded: 'השירות עמוס כרגע. נסו שוב בעוד רגע.',
    refused: 'לא ניתן לבנות קורס על הנושא הזה. נסו לנסח אותו אחרת.',
    bad_request: 'משהו בבקשה לא היה תקין. נסו לנסח את הנושא אחרת.',
    network: 'החיבור לאינטרנט נקטע. בדקו את החיבור ונסו שוב.',
    empty_completion: 'לא התקבל תוכן. נסו לנסח את הנושא אחרת.',
    default: 'משהו השתבש בבניית הקורס. אפשר לנסות שוב.'
  };
  const ERR_ORDER = ['refused', 'access_code', 'not_configured', 'rate_limited', 'overloaded', 'network', 'bad_request', 'empty_completion'];
  const RETRY = new Set(['rate_limited', 'overloaded', 'network', 'empty_completion', 'default']);

  /* ---------- a ready-made example course (no AI needed) ---------- */
  const SAMPLE = {
    sample: true, topic: 'חורים שחורים', title: 'חורים שחורים', en: 'Black hole', minutes: 10, level: 'all',
    hook: 'המקומות ביקום שבהם הכבידה מנצחת אפילו את האור.',
    chapters: [
      { title: 'מה זה חור שחור?', body: [
        'חור שחור הוא אזור בחלל שבו ==הכבידה חזקה כל כך ששום דבר לא יכול לברוח ממנו==, אפילו לא אור. לכן אי אפשר לראות אותו ישירות. רואים רק את ההשפעה שלו על מה שנמצא סביבו.',
        'הגבול שממנו אין חזרה נקרא ==אופק האירועים==. זה לא משטח שאפשר לגעת בו אלא קו דמיוני: מי שחוצה אותו כבר לא יכול לצאת, לא משנה כמה מהר ינוע.',
        'ולמרות השם, חור שחור הוא לא חור ריק. להפך: זו ==כמות עצומה של מסה שנדחסה לנפח קטן מאוד==.'
      ] },
      { title: 'איך נולד חור שחור', body: [
        'רוב החורים השחורים המוכרים נוצרים בסוף חייהם של ==כוכבים מסיביים במיוחד==, כבדים בהרבה מהשמש שלנו.',
        'כשהדלק הגרעיני של כוכב כזה נגמר, שום דבר כבר לא מחזיק את הליבה שלו מול הכבידה. ==הליבה קורסת אל תוך עצמה==, ולעיתים קרובות השכבות החיצוניות נזרקות לחלל בפיצוץ אדיר שנקרא ==סופרנובה==.',
        'השמש שלנו קלה מדי כדי להפוך לחור שחור. בעוד כחמישה מיליארד שנה היא תתנפח ל==ענק אדום==, ובסוף חייה תהפוך ל==ננס לבן==, כוכב קטן ודחוס שהולך ודועך.'
      ] },
      { title: 'קטנים, גדולים וענקיים', body: [
        '==חורים שחורים כוכביים== נוצרים מכוכבים שקרסו, ומסתם גדולה בדרך כלל פי כמה עד פי כמה עשרות ממסת השמש.',
        'במרכזן של רוב הגלקסיות הגדולות יושב ==חור שחור על-מסיבי==, שמסתו מיליוני ואפילו מיליארדי מסות שמש.',
        'גם לשביל החלב יש כזה: ==קשת A*==, שמסתו כארבעה מיליון מסות שמש. הוא נמצא במרחק של כ-26 אלף שנות אור מאיתנו, כך שאין סיבה לדאגה.'
      ] },
      { title: 'איך רואים את מה שאי אפשר לראות', body: [
        'אסטרונומים מזהים חורים שחורים לפי הסביבה שלהם: כוכבים שמקיפים "כלום" במהירות עצומה, וגז שמסתחרר פנימה ומתחמם עד שהוא ==פולט קרני רנטגן==.',
        'ב-2015 קלטו גלאי LIGO בארצות הברית לראשונה ==גלי כבידה==: אדוות זעירות במרחב-זמן, שנוצרו מהתנגשות של שני חורים שחורים במרחק של יותר ממיליארד שנות אור.',
        'ב-2019 פרסם פרויקט ==טלסקופ אופק האירועים== את התמונה הראשונה של הצל של חור שחור, בגלקסיה M87, וב-2022 גם תמונה של קשת A*. חורים שחורים כבר אינם רק תיאוריה: ==אפשר לצלם את הצל שלהם==.'
      ] }
    ],
    quiz: [
      { q: 'מהו אופק האירועים?', o: ['פני השטח המוצקים של החור השחור', 'הגבול שממנו שום דבר, גם לא אור, לא יכול לחזור', 'האזור שבו נולדים כוכבים חדשים', 'המרחק שבו הכבידה נעלמת לגמרי'], a: 1, e: 'אופק האירועים הוא גבול דמיוני ולא משטח. מי שחוצה אותו לא יכול לצאת.' },
      { q: 'מה יקרה לשמש שלנו בסוף חייה?', o: ['היא תהפוך לחור שחור', 'היא תתפוצץ בסופרנובה', 'היא תתנפח לענק אדום ותהפוך לננס לבן', 'היא תיעלם בלי להשאיר דבר'], a: 2, e: 'השמש קלה מדי כדי לקרוס לחור שחור.' },
      { q: 'איך זיהו לראשונה, ב-2015, התנגשות של שני חורים שחורים?', o: ['בתמונה של טלסקופ חלל', 'בהבזק אור כחול בשמיים', 'בגלי כבידה שקלטו גלאי LIGO', 'בשינוי בגאות ובשפל בכדור הארץ'], a: 2, e: 'ההתנגשות יצרה אדוות במרחב-זמן, וגלאי LIGO מדדו אותן.' },
      { q: 'אילו השמש הייתה הופכת פתאום לחור שחור באותה מסה, מה היה קורה למסלול של כדור הארץ?', o: ['כדור הארץ היה נבלע מיד', 'המסלול היה נשאר כמעט אותו דבר', 'כדור הארץ היה נזרק אל מחוץ למערכת השמש', 'כדור הארץ היה מתחיל להסתובב מהר יותר'], a: 1, e: 'מרחוק, חור שחור מושך כמו כל גוף אחר באותה מסה. רק היה נהיה חשוך וקר מאוד.' }
    ],
    video: {
      items: [
        { title: 'Black Holes Explained – From Birth to Death', channel: 'Kurzgesagt – In a Nutshell' },
        { title: 'The hunt for a supermassive black hole', channel: 'TED · Andrea Ghez' },
        { title: 'חורים שחורים הסבר', channel: '' }
      ],
      idea: 'אנימציה של שתי דקות: כוכב ענק קורס, נוצר אופק אירועים, וקרן אור שמנסה לברוח ונבלעת.'
    },
    fact: { text: 'אילו השמש הייתה הופכת פתאום לחור שחור באותה מסה, כדור הארץ היה ממשיך להקיף אותה ==כמעט באותו מסלול בדיוק==. הכבידה במרחק שלנו לא הייתה משתנה, רק היה נהיה חשוך וקר מאוד.' },
    spicy: { text: 'ליד חור שחור קטן, הכבידה מושכת את הרגליים חזק בהרבה מאשר את הראש, וההפרש היה מותח אדם לאורך כמו אטריה. פיזיקאים קוראים לזה, ברצינות גמורה, ==ספגטיפיקציה==.' },
    riddle: { q: 'אני כבד יותר ממיליוני שמשות, אבל אף אחד לא ראה אותי ישירות. כולם יודעים איפה אני, כי כוכבים רוקדים סביבי במהירות מסחררת. מי אני?', a: 'קשת A*, החור השחור שבמרכז שביל החלב.' },
    joke: { setup: 'למה לא כדאי להזמין חור שחור למסיבה?', punch: 'כי הוא שואב את כל האווירה.' },
    song: { items: [
      { title: 'Supermassive Black Hole', artist: 'Muse', writer: 'Matt Bellamy', year: '2006', why: 'שם השיר הוא בדיוק המונח מהפרק השלישי: ==חור שחור על-מסיבי==. השיר עצמו הוא שיר אהבה, על משיכה שאי אפשר לעמוד בפניה.' },
      { title: 'Black Hole Sun', artist: 'Soundgarden', writer: 'Chris Cornell', year: '1994', why: '==שמש שהפכה לחור שחור==, בדיוק התרחיש מהעובדה המפתיעה. הקשר למדע עקיף, אבל הדימוי חזק.' }
    ] },
    podcast: {
      title: 'מה קורה בקצה של אופק האירועים?',
      script: [
        { s: 'נועה', l: 'דני, אם הייתי זורקת פנס לתוך חור שחור, היינו רואים את האור שלו?' },
        { s: 'דני', l: 'רק עד רגע מסוים. ברגע שהפנס חוצה את אופק האירועים, שום אור ממנו כבר לא יגיע אלינו.' },
        { s: 'נועה', l: 'אז איך בכלל יודעים שחורים שחורים קיימים?' },
        { s: 'דני', l: 'לפי הסביבה. במרכז שביל החלב עקבו אסטרונומים במשך שנים אחרי כוכבים שמקיפים נקודה חשוכה במהירות עצומה.' },
        { s: 'נועה', l: 'וזה קשת A*?' },
        { s: 'דני', l: 'בדיוק. בערך ארבעה מיליון מסות שמש. על המחקר הזה הוענק פרס נובל לפיזיקה בשנת 2020.' },
        { s: 'נועה', l: 'ומה עם התמונה המפורסמת?' },
        { s: 'דני', l: 'ב-2019 חיברו טלסקופים מכל העולם כאילו היו טלסקופ אחד בגודל כדור הארץ, וצילמו את הצל של החור השחור בגלקסיה M87.' },
        { s: 'נועה', l: 'אז בפעם הבאה שמישהו יגיד שחור שחור שואב הכול?' },
        { s: 'דני', l: 'נגיד לו שמרחוק הוא מושך כמו כל גוף אחר באותה מסה. רק מקרוב מאוד הוא הופך למלכודת.' }
      ],
      recs: [
        { name: 'StarTalk', lang: 'אנגלית', why: 'ניל דגראס טייסון על אסטרונומיה ומדע' },
        { name: 'Daniel and Jorge Explain the Universe', lang: 'אנגלית', why: 'פיזיקאי וקריקטוריסט מסבירים את היקום' },
        { name: 'עושים היסטוריה', lang: 'עברית', why: 'רן לוי על מדע, טכנולוגיה והיסטוריה' }
      ]
    },
    sources: { en: 'black hole', orgs: [
      { name: 'נאס״א', why: 'הסברים ותמונות מתצפיות חלל' },
      { name: 'Event Horizon Telescope', why: 'הפרויקט שצילם את הצל של החור השחור' },
      { name: 'מכון דוידסון לחינוך מדעי', why: 'כתבות מדע בעברית' }
    ] },
    art: [
      { caption: 'הטבעת הזוהרת סביב הצל של החור השחור ב-M87, בהשראת הצילום מ-2019.',
        svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'><rect width='400' height='300' fill='#F5F5F1'/><g fill='#121212'><circle cx='46' cy='50' r='2.6'/><circle cx='346' cy='38' r='2'/><circle cx='362' cy='246' r='2.6'/><circle cx='60' cy='250' r='2'/><circle cx='318' cy='92' r='1.6'/><circle cx='84' cy='118' r='1.6'/><circle cx='334' cy='190' r='1.6'/><circle cx='104' cy='206' r='1.4'/></g><circle cx='200' cy='150' r='104' fill='none' stroke='#121212' stroke-width='1.5' stroke-dasharray='2 7' stroke-linecap='round'/><circle cx='200' cy='150' r='74' fill='none' stroke='#FFE63B' stroke-width='30'/><path d='M264.1 187 A74 74 0 0 1 135.9 187' fill='none' stroke='#FFE63B' stroke-width='42' stroke-linecap='round'/><circle cx='200' cy='150' r='92' fill='none' stroke='#121212' stroke-width='2.5'/><circle cx='200' cy='143' r='56' fill='#121212'/></svg>" },
      { caption: 'הכבידה מעקמת את מסלול האור. קרן שמתקרבת מדי נבלעת.',
        svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 300'><defs><marker id='h' viewBox='0 0 10 10' refX='8' refY='5' markerWidth='7' markerHeight='7' orient='auto-start-reverse'><path d='M0 0 L10 5 L0 10 Z' fill='#121212'/></marker></defs><rect width='640' height='300' fill='#F5F5F1'/><circle cx='330' cy='150' r='78' fill='none' stroke='#121212' stroke-width='2' stroke-dasharray='4 7'/><g fill='none' stroke='#121212' stroke-width='3' stroke-linecap='round'><path d='M30 34 C 220 34, 360 40, 600 70' marker-end='url(#h)'/><path d='M30 266 C 220 266, 360 260, 600 230' marker-end='url(#h)'/><path d='M30 92 C 210 92, 300 88, 372 112 S 520 200, 600 236' marker-end='url(#h)'/><path d='M30 208 C 210 208, 300 212, 372 188 S 520 100, 600 64' marker-end='url(#h)'/></g><path d='M30 132 C 170 132, 262 132, 300 140 S 322 150, 318 154' fill='none' stroke='#FFE63B' stroke-width='12' stroke-linecap='round'/><path d='M30 132 C 170 132, 262 132, 300 140 S 322 150, 318 154' fill='none' stroke='#121212' stroke-width='3' stroke-linecap='round'/><circle cx='330' cy='150' r='40' fill='#121212'/></svg>" },
      { caption: 'כדור הארץ היה ממשיך באותו מסלול, גם סביב חור שחור במסת השמש.',
        svg: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'><defs><marker id='h' viewBox='0 0 10 10' refX='7' refY='5' markerWidth='6' markerHeight='6' orient='auto'><path d='M0 0 L10 5 L0 10 Z' fill='#121212'/></marker></defs><rect width='400' height='300' fill='#F5F5F1'/><circle cx='200' cy='150' r='112' fill='none' stroke='#121212' stroke-width='2.5' stroke-dasharray='2 8' stroke-linecap='round'/><circle cx='200' cy='150' r='40' fill='#FFE63B'/><circle cx='200' cy='150' r='40' fill='none' stroke='#121212' stroke-width='2' stroke-dasharray='5 6'/><circle cx='200' cy='150' r='10' fill='#121212'/><circle cx='279' cy='71' r='16' fill='#FFFFFF' stroke='#121212' stroke-width='3'/><path d='M228 49 A112 112 0 0 1 256 58' fill='none' stroke='#121212' stroke-width='3' stroke-linecap='round' marker-end='url(#h)'/><path d='M306 100 A112 112 0 0 1 320 140' fill='none' stroke='#121212' stroke-width='3' stroke-linecap='round' marker-end='url(#h)'/></svg>" }
    ]
  };

  /* ---------- state ---------- */
  let view = 'home';
  let course = null;
  let gen = null;
  let ui = freshUI();
  function freshUI() { return { ch: 0, quiz: { i: 0, picked: null, score: 0, done: false }, riddle: false, joke: false, speaking: false, line: -1, scriptOpen: false, noVoice: false, vid: 0 }; }
  function newCourse(topic, minutes, level) {
    return { sample: false, topic, title: '', en: '', hook: '', minutes, level, chapters: [], quiz: null, video: null, fact: null, spicy: null, riddle: null, joke: null, song: null, podcast: null, sources: null, art: [] };
  }
  const running = (c, part) => !!gen && gen.c === c && gen.parts[part] === 'run';
  const building = part => running(course, part);

  /* ---------- this site's server: what is set up ---------- */
  let server = { known: false, ai: false, youtube: false, accessCode: false };
  const codeInput = $('#accessCode');
  codeInput.value = store.get('sakran:code') || '';
  const accessCode = () => codeInput.value.trim();
  const serverReady = getJSON('/api/status', { cache: 'no-store' }).then(s => {
    if (s && !s.error) server = { known: true, ai: !!s.ai, youtube: !!s.youtube, accessCode: !!s.accessCode };
    $('#codeRow').hidden = !server.accessCode;
    if (course) { wantMedia(course); R.video(); }
    return server;
  });

  /* ---------- one part of a course, streamed from /api/course ---------- */
  async function streamPart(part, c, opts) {
    const signal = opts.signal;
    let res;
    try {
      res = await fetch('/api/course', {
        method: 'POST', signal, cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-access-code': enc(accessCode()) },
        body: JSON.stringify({ part, topic: c.topic, minutes: c.minutes, level: c.level })
      });
    } catch (e) { throw { code: signal.aborted ? 'aborted' : 'network' }; }
    if (!res.ok || !res.body) {
      let code = res.status === 429 ? 'rate_limited' : 'upstream_error';
      try { const j = await res.json(); if (j && typeof j.error === 'string') code = j.error; } catch (e) {}
      throw { code };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        const t = dec.decode(r.value, { stream: true });
        if (t) { text += t; opts.onText(t); }
      }
      const rest = dec.decode();
      if (rest) { text += rest; opts.onText(rest); }
    } catch (e) { throw { code: signal.aborted ? 'aborted' : 'network' }; }
    return { text };
  }

  /* ---------- reading the streamed answer ---------- */
  function parseObj(s) {
    try { return JSON.parse(s); } catch (e) {}
    try { return JSON.parse(s.replace(/([֐-׿])"(?=[֐-׿])/g, '$1״')); } catch (e) {}
    return null;
  }
  /* an illustration line whose svg broke the JSON (double quotes inside it): take the parts out by hand */
  function salvageArt(line) {
    if (!/"t"\s*:\s*"art"/.test(line)) return null;
    const n = Number((line.match(/"n"\s*:\s*"?([1-3])/) || [])[1]);
    const i = line.indexOf('<svg'), j = line.lastIndexOf('</svg>');
    if (!n || i < 0 || j < i) return null;
    const cap = (line.match(/"caption"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || '';
    return { t: 'art', n, caption: cap.replace(/\\(.)/g, '$1'), svg: line.slice(i, j + 6).replace(/\\(["\\/])/g, '$1') };
  }
  function tryLine(line, onObj) {
    const i = line.indexOf('{'), j = line.lastIndexOf('}');
    if (i < 0 || j <= i) return;
    const o = parseObj(line.slice(i, j + 1)) || salvageArt(line);
    if (o && typeof o === 'object' && !Array.isArray(o) && typeof o.t === 'string') onObj(o);
  }
  /* an svg written over several lines: join the lines back and read again */
  function rescueArt(text, onObj) {
    text.replace(/\r?\n(?!\s*(?:\{|```))/g, ' ').split('\n').forEach(l => { if (l.includes('art')) tryLine(l, onObj); });
  }
  function lineEater(onObj) {
    let pending = '';
    return {
      push(delta) { const parts = (pending + delta).split('\n'); pending = parts.pop(); parts.forEach(l => tryLine(l, onObj)); },
      flush() { if (pending.trim()) tryLine(pending, onObj); pending = ''; }
    };
  }
  /* fallback when the answer was not one object per line (pretty-printed or an array) */
  function scanAll(text, onObj) {
    let depth = 0, inStr = false, esc2 = false, start = -1;
    for (let p = 0; p < text.length; p++) {
      const ch = text[p];
      if (inStr) { if (esc2) esc2 = false; else if (ch === '\\') esc2 = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"' && depth > 0) { inStr = true; continue; }
      if (ch === '{') { if (depth === 0) start = p; depth++; }
      else if (ch === '}' && depth > 0) {
        depth--;
        if (depth === 0) { const o = parseObj(text.slice(start, p + 1)); if (o && typeof o.t === 'string') onObj(o); }
      }
    }
  }

  const FLASH = { meta: '', chapter: 'feed', quiz: 'quiz', video: 'video', fact: 'fact', spicy: 'spicy', riddle: 'riddle', joke: 'joke', podcast: 'podcast', song: 'song', sources: 'sources' };
  function flash(k) {
    const b = B(k); if (!b) return;
    b.classList.remove('fresh'); void b.offsetWidth; b.classList.add('fresh');
    clearTimeout(b._ft); b._ft = setTimeout(() => b.classList.remove('fresh'), 700);
  }
  function applyItem(c, o) {
    const before = c.chapters.length;
    const artN = o.t === 'art' ? Number(o.n) : 0;
    const had = !!artN && !!arr(c.art)[artN - 1];
    applyItem2(c, o);
    let k = FLASH[o.t];
    if (artN) k = !had && arr(c.art)[artN - 1] ? 'img' + artN : '';
    if (k && !(o.t === 'chapter' && (before > 0 || c.chapters.length === 0))) flash(k);
  }
  function applyItem2(c, o) {
    switch (o.t) {
      case 'meta':
        c.title = str(o.title).slice(0, 80) || c.title; c.hook = str(o.hook).slice(0, 220); c.en = str(o.en).slice(0, 120) || c.en;
        renderHead(); break;
      case 'chapter': {
        const body = arr(o.body).map(str).filter(Boolean);
        if (!body.length) return;
        c.chapters.push({ title: str(o.title), body }); renderFeed();
        if (c.chapters.length === 1) timerStart();
        break;
      }
      case 'quiz': {
        const items = arr(o.items).map(q => ({ q: str(q && q.q), o: arr(q && q.o).map(str).filter(Boolean).slice(0, 6), a: Number(q && q.a), e: str(q && q.e) }))
          .filter(q => q.q && q.o.length >= 2 && Number.isInteger(q.a) && q.a >= 0 && q.a < q.o.length);
        if (items.length) { c.quiz = items; renderQuiz(); renderFeed(); }
        break;
      }
      case 'video': {
        let items = arr(o.items).map(x => (typeof x === 'string' ? { title: str(x), channel: '' } : { title: str(x && x.title), channel: str(x && x.channel) })).filter(x => x.title).slice(0, 3);
        if (!items.length) items = arr(o.queries).map(str).filter(Boolean).slice(0, 3).map(q => ({ title: q, channel: '' }));
        if (!items.length) items = [{ title: c.title || c.topic, channel: '' }];
        c.video = { items, idea: str(o.idea) }; renderVideo(); break;
      }
      case 'fact': case 'spicy': { const t = str(o.text); if (t) { c[o.t] = { text: t }; R[o.t](); } break; }
      case 'riddle': { const q = str(o.q), a = str(o.a); if (q && a) { c.riddle = { q, a }; renderRiddle(); } break; }
      case 'joke': { const s = str(o.setup), p = str(o.punch); if (s) { c.joke = { setup: s, punch: p }; renderJoke(); } break; }
      case 'podcast': {
        const script = arr(o.script).map(l => ({ s: str(l && l.s) || 'מגיש', l: str(l && l.l) })).filter(l => l.l);
        const recs = arr(o.recs).map(r => ({ name: str(r && r.name), lang: str(r && r.lang), why: str(r && r.why) })).filter(r => r.name).slice(0, 3);
        c.podcast = { title: str(o.title) || ('פרק על ' + (c.title || c.topic)), script, recs }; renderPodcast(); break;
      }
      case 'song': {
        const items = arr(o.items).map(x => ({ title: str(x && x.title), artist: str(x && x.artist), writer: str(x && x.writer), year: str(x && x.year), why: str(x && x.why) }))
          .filter(x => x.title && x.artist).slice(0, 3);
        if (items.length) { c.song = { items }; renderSong(); }
        break;
      }
      case 'sources': {
        c.sources = { en: str(o.en), orgs: arr(o.orgs).map(r => ({ name: str(r && r.name), why: str(r && r.why) })).filter(r => r.name).slice(0, 4) };
        renderSources(); break;
      }
      case 'art': {
        const n = Number(o.n);
        if (!Number.isInteger(n) || n < 1 || n > 3 || arr(c.art)[n - 1]) return;
        const svg = cleanSvg(o.svg);
        if (!svg) return;
        if (!Array.isArray(c.art)) c.art = [];
        c.art[n - 1] = { svg, caption: str(o.caption).slice(0, 160) };
        renderArt(n - 1);
        break;
      }
    }
  }

  /* ---------- building a course ---------- */
  function build(topic, minutes, level) {
    const c = newCourse(topic, minutes, level);
    openCourse(c);
    const g = gen = { c, ctls: [new AbortController(), new AbortController(), new AbortController()], t0: Date.now(), parts: { a: 'run', b: 'run', c: 'run' }, errors: [], first: false, stopped: false, refused: false, reported: false, tick: 0 };
    renderAll();
    setStatus('building');
    g.tick = setInterval(() => { const el = $('#elapsed'); if (el && gen === g) el.textContent = fmt((Date.now() - g.t0) / 1000); }, 1000);
    const run = (part, ctl) => {
      let count = 0, errCode = '';
      const onObj = o => {
        if (gen !== g) return;
        if (o.t === 'error') { errCode = str(o.code) || 'default'; return; }
        count++;
        if (!g.first && !g.reported) { g.first = true; setStatus('building'); }
        applyItem(c, o);
        wantMedia(c);
      };
      const eat = lineEater(onObj);
      return streamPart(part, c, { signal: ctl.signal, onText: t => { if (gen === g) eat.push(t); } })
        .then(r => {
          eat.flush();
          const text = (r && r.text) || '';
          if (!count && text) scanAll(text, onObj);
          if (part === 'c' && text && arr(c.art).filter(Boolean).length < 3) rescueArt(text, onObj);
          if (errCode && errCode !== 'truncated') throw { code: errCode }; /* truncated: keep what arrived */
          if (!count) throw { code: 'empty_completion' };
          g.parts[part] = 'ok';
        })
        .catch(e => {
          eat.flush();
          g.parts[part] = 'err';
          if (part === 'c') return; /* the illustrations are a bonus: the course works without them */
          const code = (e && e.code) || 'default';
          if (code === 'aborted') return; /* stopped on purpose */
          g.errors.push(code);
          if (code === 'refused') g.refused = true;
        })
        .finally(() => {
          if (gen !== g) return;
          if (part === 'a') { renderFeed(); renderQuiz(); }
          else if (part === 'b') { ['video', 'podcast', 'fact', 'spicy', 'riddle', 'joke', 'song', 'sources'].forEach(k => R[k]()); }
          else { [0, 1, 2].forEach(renderArt); }
          finishIfDone(g);
          wantMedia(c);
        });
    };
    run('a', g.ctls[0]);
    run('b', g.ctls[1]);
    run('c', g.ctls[2]);
  }

  /* The course is reported once the text parts (a, b) are done; the illustrations (c) may keep arriving after that. */
  function finishIfDone(g) {
    if (g.parts.a === 'run' || g.parts.b === 'run') return;
    const all = g.parts.c !== 'run';
    if (all) { clearInterval(g.tick); if (gen === g) gen = null; }
    const c = g.c;
    if (course !== c) return;
    if (g.reported) { if (all && !g.refused && !g.stopped) saveLast(c); return; }
    g.reported = true;
    if (g.refused) {
      g.parts.c = 'err';
      try { g.ctls[2].abort(); } catch (e) {}
      Object.assign(c, newCourse(c.topic, c.minutes, c.level), { refused: true });
      ui = freshUI(); renderHead(); renderAll();
      setStatus('error', { msg: ERR.refused, sample: true });
      return;
    }
    renderAll();
    if (g.stopped) { setStatus('stopped'); saveLast(c); return; }
    if (!g.errors.length) {
      setStatus('none'); saveLast(c);
      if (!timer.running && !timer.ended && c.chapters.length) timerStart();
      return;
    }
    const code = ERR_ORDER.find(k => g.errors.includes(k)) || 'default';
    const hasAny = c.chapters.length > 0;
    if (code === 'access_code') $('#codeRow').hidden = false;
    setStatus('error', {
      msg: (hasAny ? 'חלק מהקורס לא נוצר. ' : '') + (ERR[code] || ERR.default),
      retry: RETRY.has(code), sample: !hasAny && code !== 'access_code', code: code === 'access_code'
    });
    if (hasAny) saveLast(c);
  }
  function abortGen() {
    if (!gen) return;
    const g = gen; gen = null;
    g.stopped = true; clearInterval(g.tick);
    g.ctls.forEach(a => { try { a.abort(); } catch (e) {} });
  }
  function saveLast(c) { if (!c.sample && !c.refused && c.chapters.length) store.set('sakran:last', c); }

  function setStatus(kind, info) {
    const el = $('#status');
    if (kind === 'none') { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.className = 'status ' + kind;
    if (kind === 'building') {
      const first = gen && gen.first;
      el.innerHTML = '<span class="ind" aria-hidden="true"></span>'
        + '<span>' + (first ? 'הקורס נכתב מול העיניים שלכם' : 'בונים את הקורס שלכם') + ' · <span class="t-read" id="elapsed">' + fmt(gen ? (Date.now() - gen.t0) / 1000 : 0) + '</span></span>'
        + '<button class="txtbtn" type="button" data-act="stop">עצירה</button>';
    } else if (kind === 'stopped') {
      el.innerHTML = '<span>הבנייה נעצרה. מה שכבר נכתב נשאר כאן.</span><button class="txtbtn" type="button" data-act="retry">לבנות מחדש</button>';
    } else {
      el.innerHTML = '<span class="err-sq" aria-hidden="true"></span><span>' + esc(info.msg) + '</span>'
        + (info.retry ? '<button class="txtbtn" type="button" data-act="retry">לנסות שוב</button>' : '')
        + (info.code ? '<button class="txtbtn" type="button" data-act="home" data-focus="code">להזנת הקוד</button>' : '')
        + (info.sample ? '<button class="txtbtn" type="button" data-act="sample">לקורס המוכן</button>' : '');
    }
  }

  /* ---------- real media: videos, photos, songs and podcasts, found by this site's server ---------- */
  const tried = new WeakMap(), busy = new WeakMap();
  function begin(c, key) {
    let t = tried.get(c); if (!t) tried.set(c, (t = new Set()));
    if (t.has(key)) return false;
    t.add(key);
    let b = busy.get(c); if (!b) busy.set(c, (b = new Set()));
    b.add(key);
    return true;
  }
  const end = (c, key) => { const b = busy.get(c); if (b) b.delete(key); };
  const loading = (c, key) => { const b = busy.get(c); return !!b && b.has(key); };
  const englishName = c => c.en || (c.sources && c.sources.en) || '';
  /* save media found after the course was saved, unless the learner moved on to another course */
  function persist(c) { if (course === c && !(gen && gen.c === c)) saveLast(c); }

  function wantMedia(c) {
    if (!c || c !== course || c.refused || !server.known) return;
    if (server.youtube && c.video && c.videos === undefined && begin(c, 'videos')) loadVideos(c);
    if (c.photos === undefined && (englishName(c) || (c.title && !running(c, 'a'))) && begin(c, 'photos')) loadPhotos(c);
    if (c.song && arr(c.song.items).length && !c.song.checked && begin(c, 'songs')) loadSongs(c);
    if (c.podcast && !c.podcast.checked && begin(c, 'podcast')) loadPodcast(c);
  }

  const cleanVideo = v => (v && /^[\w-]{6,20}$/.test(String(v.id))
    ? { id: String(v.id), title: str(v.title).slice(0, 200), channel: str(v.channel).slice(0, 100), duration: Math.max(0, Number(v.duration) || 0) } : null);
  function loadVideos(c) {
    R.video();
    const name = c.title || c.topic;
    const queries = [{ q: name + (c.level === 'kids' ? ' לילדים' : ' הסבר'), lang: 'he' }];
    const first = arr(c.video.items)[0];
    if (first && first.title) {
      const q = [first.title, first.channel].filter(Boolean).join(' ');
      if (q !== queries[0].q) queries.push({ q, lang: hasHe(q) ? 'he' : 'en' });
    }
    if (c.level !== 'kids') queries.reverse(); /* the AI's pick first; Hebrew first for children */
    Promise.all(queries.map(x => getJSON('/api/videos?' + qs(x)))).then(res => {
      end(c, 'videos');
      if (c.refused) return;
      const lists = res.map(r => arr(r && r.items).map(cleanVideo).filter(Boolean));
      const out = [], seen = new Set();
      for (let i = 0; i < 4; i++) lists.forEach(l => { const v = l[i]; if (v && !seen.has(v.id) && out.length < 4) { seen.add(v.id); out.push(v); } });
      if (out.length || res.some(r => r && !r.error)) c.videos = out;
      if (course === c) { R.video(); if (out.length) flash('video'); }
      persist(c);
    });
  }

  const PHOTO_SLOTS = ['ph1', 'ph2', 'ph3'];
  const cleanPhoto = p => (p && /^https:\/\/upload\.wikimedia\.org\//.test(safe(p.src))
    ? { title: str(p.title).slice(0, 200), src: p.src, page: safe(p.page), author: str(p.author).slice(0, 100), license: str(p.license).slice(0, 60), licenseUrl: safe(p.licenseUrl) } : null);
  function loadPhotos(c) {
    getJSON('/api/photos?' + qs({ en: englishName(c), he: c.title || c.topic })).then(r => {
      end(c, 'photos');
      if (c.refused) return;
      const items = arr(r && r.items).map(cleanPhoto).filter(Boolean).slice(0, 3);
      if (items.length || !(r && r.error)) c.photos = items;
      if (course === c) PHOTO_SLOTS.forEach((k, i) => { R[k](); if (items[i]) flash(k); });
      persist(c);
    });
  }

  const cleanSong = x => ({ title: str(x.title).slice(0, 200), artist: str(x.artist).slice(0, 120), year: str(x.year).slice(0, 4), artwork: safe(x.artwork), preview: safe(x.preview), url: safe(x.url) });
  function loadSongs(c) {
    const s = c.song;
    Promise.all(s.items.map(it => getJSON('/api/music?' + qs({ title: it.title, artist: it.artist })).then(r => {
      if (r && r.found && r.song) it.found = cleanSong(r.song);
      else if (r && r.found === false && !r.error) it.found = false;
    }))).then(() => {
      end(c, 'songs');
      if (c.refused) return;
      s.checked = s.items.every(it => it.found !== undefined);
      if (course === c) R.song();
      persist(c);
    });
  }

  const cleanEpisode = e => (e && safe(e.audio) && str(e.title)
    ? { title: str(e.title).slice(0, 200), show: str(e.show).slice(0, 120), artwork: safe(e.artwork), audio: e.audio, url: safe(e.url), duration: Math.max(0, Number(e.duration) || 0) } : null);
  const cleanShow = x => ({ name: str(x.name).slice(0, 160), author: str(x.author).slice(0, 120), artwork: safe(x.artwork), url: safe(x.url) });
  function loadPodcast(c) {
    const p = c.podcast;
    let fine = true;
    const seen = r => { if (!r || r.error) fine = false; return r || {}; };
    const jobs = [getJSON('/api/podcasts?' + qs({ he: c.title || c.topic, en: englishName(c) })).then(r => {
      r = seen(r);
      if (Array.isArray(r.items)) p.episodes = r.items.map(cleanEpisode).filter(Boolean).slice(0, 3);
    })];
    arr(p.recs).forEach(rec => jobs.push(getJSON('/api/podcasts?' + qs({ name: rec.name })).then(r => {
      r = seen(r);
      if (r.found && r.show) rec.found = cleanShow(r.show);
      else if (r.found === false) rec.found = false;
    })));
    Promise.all(jobs).then(() => {
      end(c, 'podcast');
      if (c.refused) return;
      p.checked = fine;
      if (course === c) R.podcast();
      persist(c);
    });
  }

  /* ---------- one audio player, for song previews and podcast episodes ---------- */
  const player = { el: null, src: '', on: false };
  const playing = src => player.on && player.src === src;
  function syncPlayers() {
    D.querySelectorAll('[data-act="aplay"]').forEach(b => {
      const on = playing(b.dataset.src);
      b.setAttribute('aria-pressed', String(on));
      const ic = b.querySelector('.ic'); if (ic) ic.innerHTML = on ? ICON.pause : ICON.play;
    });
  }
  function audioToggle(src) {
    if (!safe(src)) return;
    if (!player.el) {
      const a = player.el = new Audio();
      a.preload = 'none';
      const sync = () => { player.on = !a.paused && !a.ended; syncPlayers(); };
      ['play', 'playing', 'pause', 'ended', 'error'].forEach(ev => a.addEventListener(ev, sync));
    }
    const a = player.el;
    if (player.src === src && !a.ended) { if (a.paused) a.play().catch(() => {}); else a.pause(); return; }
    stopSpeech();
    player.src = src; a.src = src;
    player.on = true; syncPlayers();
    a.play().catch(() => { player.on = false; syncPlayers(); });
  }
  function audioStop() {
    if (player.el) { try { player.el.pause(); } catch (e) {} }
    player.src = ''; player.on = false; syncPlayers();
  }
  function playBtn(cls, src, label, text) {
    const on = playing(src);
    return '<button class="' + cls + '" type="button" data-act="aplay" data-src="' + esc(src) + '" aria-pressed="' + on + '"' + (text ? '' : ' aria-label="' + esc(label) + '"') + '>'
      + '<span class="ic" aria-hidden="true">' + (on ? ICON.pause : ICON.play) + '</span>' + (text ? '<span>' + esc(text) + '</span>' : '') + '</button>';
  }

  /* ---------- course view ---------- */
  function buildShells() {
    Object.keys(COLS).forEach(col => {
      const el = $('#col-' + col);
      el.innerHTML = '';
      COLS[col].forEach(k => {
        const t = TILES[k];
        const a = D.createElement('article');
        a.id = 't-' + k;
        a.style.setProperty('--o', t.o);
        if (t.img) {
          a.className = 'cell c-img c-' + k;
          a.setAttribute('aria-label', t.label);
          a.hidden = true;
          a.innerHTML = '<div class="cell-b" id="b-' + k + '"></div>';
        } else {
          a.className = 'cell c-' + k;
          a.setAttribute('aria-labelledby', 'h-' + k);
          a.innerHTML = '<header class="cell-h"><h2 class="label" id="h-' + k + '">' + t.label + '</h2><span class="meta" id="m-' + k + '"></span></header><div class="cell-b" id="b-' + k + '"></div>';
        }
        el.appendChild(a);
      });
    });
  }
  const B = k => $('#b-' + k);
  const M = (k, t) => { const m = $('#m-' + k); if (m) m.textContent = t || ''; };
  const sk = (note, n, tall) => '<div class="sk' + (tall ? ' tall' : '') + '" aria-hidden="true">' + '<i></i>'.repeat(n || 3) + '</div><p class="sk-note">' + note + '</p>';
  const miss = () => '<p class="muted">החלק הזה לא נוצר הפעם.</p>';
  const pend = (k, part) => (building(part) ? sk(PENDING[k]) : miss());
  const planMin = k => { const it = (PLANS[course.minutes] || []).find(p => p[0] === k); return it ? it[1] + ' דק׳' : ''; };
  const ext = (href, label, note) => '<li><a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>' + (note ? '<span class="note">' + esc(note) + '</span>' : '') + '</li>';
  const out = (href, label) => '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>';

  function renderHead() {
    const c = course; if (!c) return;
    const name = c.title || c.topic;
    $('#eyebrow').textContent = 'קורס של ' + c.minutes + ' דקות · ' + (LEVELS[c.level] || LEVELS.all).label + (c.sample ? ' · קורס מוכן' : '');
    const t = $('#cTitle');
    if (t.textContent !== name) { t.textContent = name; t.style.animation = 'none'; void t.offsetWidth; t.style.animation = ''; }
    const hook = $('#cHook'); hook.textContent = c.hook || ''; hook.hidden = !c.hook;
    const items = PLANS[c.minutes] || PLANS[10];
    $('#tlSegs').innerHTML = items.map(p => '<span style="flex:' + p[1] + '">' + TL_LABEL[p[0]] + '</span>').join('');
  }

  function renderFeed() {
    const b = B('feed'); if (!b) return;
    const c = course, n = c.chapters.length;
    if (!n) { M('feed', ''); setHTML(b, building('a') ? sk(PENDING.feed, 8, true) : miss()); return; }
    const writing = building('a');
    const expected = writing ? Math.max(CHAPTERS[c.minutes] || n, n) : n;
    const i = Math.min(ui.ch, n - 1); ui.ch = i;
    const ch = c.chapters[i];
    const words = plain(ch.body.join(' ')).split(/\s+/).length;
    const mins = Math.max(1, Math.round(words / 170));
    M('feed', mins === 1 ? 'דקת קריאה' : mins + ' דקות קריאה');
    const last = i === n - 1;
    let nextBtn;
    if (!last) nextBtn = '<button class="navbtn next" type="button" data-act="next">הפרק הבא ←</button>';
    else if (writing) nextBtn = '<button class="navbtn next" type="button" disabled>הפרק הבא נכתב...</button>';
    else if (c.quiz) nextBtn = '<button class="navbtn next" type="button" data-act="toquiz">למבחן העצמי ←</button>';
    else nextBtn = '<button class="navbtn next" type="button" disabled>סוף הפיד</button>';
    setHTML(b, '<h3 class="ch-title">' + esc(ch.title || ('פרק ' + (i + 1))) + '</h3>'
      + '<div class="ch-body">' + ch.body.map(p => '<p>' + rich(p) + '</p>').join('') + '</div>'
      + (last && !writing ? '<p class="feed-end">זה היה הפרק האחרון. ' + (c.quiz ? 'עכשיו אפשר לבדוק מה נשאר לכם בראש.' : 'כל הכבוד!') + '</p>' : '')
      + '<nav class="feed-nav" aria-label="מעבר בין הפרקים">'
      + '<button class="navbtn" type="button" data-act="prev"' + (i === 0 ? ' disabled' : '') + '>→ הקודם</button>'
      + '<span class="count" aria-label="פרק ' + (i + 1) + ' מתוך ' + expected + '"><span class="t-read"><b>' + (i + 1) + '</b>/' + expected + '</span></span>'
      + nextBtn + '</nav>');
  }

  function renderQuiz() {
    const b = B('quiz'); if (!b) return;
    const items = course.quiz;
    if (!items) { M('quiz', ''); setHTML(b, pend('quiz', 'a')); return; }
    const q = ui.quiz;
    M('quiz', items.length + ' שאלות');
    if (q.done) {
      const ratio = q.score / items.length;
      const line = ratio === 1 ? 'מושלם. הנושא אצלכם.' : ratio >= .5 ? 'יפה מאוד. שווה לחזור לפיד ולחזק את מה שפספסתם.' : 'כדאי לעבור שוב על הפיד ולנסות שוב.';
      setHTML(b, '<p class="score"><span class="t-read">' + q.score + '<small>/' + items.length + '</small></span></p><p class="read">' + line + '</p><button class="txtbtn" type="button" data-act="qreset">שוב מההתחלה</button>');
      return;
    }
    const it = items[Math.min(q.i, items.length - 1)];
    const answered = q.picked != null;
    const ok = answered && q.picked === it.a;
    setHTML(b, '<p class="q-count">שאלה ' + (q.i + 1) + ' מתוך ' + items.length + '</p>'
      + '<p class="q-text">' + rich(it.q) + '</p>'
      + '<div class="opts">' + it.o.map((o, k) => {
        const cls = answered ? (k === it.a ? ' right' : (k === q.picked ? ' wrong' : '')) : '';
        return '<button class="opt' + cls + '" type="button" data-act="qpick" data-k="' + k + '"' + (answered ? ' disabled' : '') + '><span class="key" aria-hidden="true">' + (KEYS[k] || '') + '</span><span>' + esc(o) + '</span></button>';
      }).join('') + '</div>'
      + (answered ? '<p class="q-fb ' + (ok ? 'ok' : 'no') + '"><b>' + (ok ? 'נכון.' : 'לא בדיוק.') + '</b>' + rich(it.e || '') + '</p>'
        + '<button class="navbtn next" type="button" data-act="qnext" style="justify-self:start">' + (q.i + 1 < items.length ? 'השאלה הבאה ←' : 'לתוצאה ←') + '</button>' : ''));
  }

  /* videos: real ones from YouTube when this site has a YouTube key, otherwise search links */
  const thumb = (id, q) => 'https://i.ytimg.com/vi/' + id + '/' + q + 'default.jpg';
  function embedUrl(v) {
    const p = { autoplay: 1, rel: 0, playsinline: 1, hl: 'he' };
    if (!hasHe(v.title)) { p.cc_load_policy = 1; p.cc_lang_pref = 'he'; } /* Hebrew captions when the video has them */
    return 'https://www.youtube-nocookie.com/embed/' + v.id + '?' + qs(p);
  }
  const vsearch = it => '<a class="vcard" href="' + esc('https://www.youtube.com/results?search_query=' + enc([it.title, it.channel].filter(Boolean).join(' '))) + '" target="_blank" rel="noopener noreferrer">'
    + '<span class="thumb" aria-hidden="true">' + ICON.play + '</span>'
    + '<span class="vt"><b>' + esc(it.title) + '</b><small>' + esc(it.channel || 'חיפוש ביוטיוב') + '</small></span></a>';
  const vcard = (v, k) => '<button class="vcard" type="button" data-act="vopen" data-k="' + k + '">'
    + '<span class="thumb" aria-hidden="true"><img src="' + esc(thumb(v.id, 'mq')) + '" alt="" loading="lazy">' + (v.duration ? '<span class="vdur">' + fmt(v.duration) + '</span>' : '') + '</span>'
    + '<span class="vt"><b>' + esc(v.title) + '</b><small>' + esc(v.channel) + '</small></span></button>';
  function renderVideo() {
    const b = B('video'); if (!b) return;
    const c = course, v = c.video, vids = arr(c.videos);
    M('video', planMin('video'));
    if (vids.length) {
      const i = Math.min(ui.vid, vids.length - 1), cur = vids[i];
      const more = vids.map((x, k) => (k === i ? '' : vcard(x, k))).join('');
      setHTML(b, '<button class="vposter" type="button" data-act="vopen" data-k="' + i + '" aria-label="' + esc('צפייה בסרטון: ' + cur.title) + '">'
        + '<img src="' + esc(thumb(cur.id, 'hq')) + '" alt="" loading="lazy"><span class="vbtn" aria-hidden="true">' + ICON.play + '</span>'
        + (cur.duration ? '<span class="vdur">' + fmt(cur.duration) + '</span>' : '') + '</button>'
        + '<p class="vnow"><b>' + esc(cur.title) + '</b><small>' + esc(cur.channel) + '</small></p>'
        + (more ? '<div class="sub"><p class="mini-h">עוד סרטונים</p><div class="vlist">' + more + '</div></div>' : '')
        + '<p class="soon-note">סרטון אישי על הנושא ייווצר בקרוב...</p>');
      return;
    }
    if (v && loading(c, 'videos')) {
      setHTML(b, '<div class="vwait"><span>מחפשים סרטונים ביוטיוב...</span></div>' + (v.idea ? '<p class="videa">' + esc(v.idea) + '</p>' : ''));
      return;
    }
    const items = v ? arr(v.items) : [];
    setHTML(b, '<div class="vbox"><div class="vin"><span class="play">' + ICON.play + '</span><p class="soon">התוכן יווצר בקרוב...</p></div></div>'
      + (v && v.idea ? '<p class="videa">' + esc(v.idea) + '</p>' : '')
      + (v ? '<div class="sub"><p class="mini-h">בינתיים, סרטונים קיימים ביוטיוב</p><div class="vlist">' + items.map(vsearch).join('') + '</div></div>' : pend('video', 'b')));
  }

  /* the player opens large, over the page, and closes back to the course */
  const dlg = $('#vdlg');
  function openVideo(k) {
    const vids = arr(course && course.videos), v = vids[k];
    if (!v) return;
    ui.vid = k; renderVideo();
    stopSpeech(); audioStop();
    dlg.innerHTML = '<div class="vdlg-bar"><div class="vdlg-t"><b id="vdlgT">' + esc(v.title) + '</b><small>' + esc(v.channel) + '</small></div>'
      + '<button class="txtbtn" type="button" data-act="vclose">סגירה</button></div>'
      + '<div class="vplayer"><iframe src="' + esc(embedUrl(v)) + '" title="' + esc(v.title) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
  }
  function closeVideo() { if (dlg.open) { try { dlg.close(); } catch (e) { dlg.removeAttribute('open'); } } dlg.innerHTML = ''; }
  dlg.addEventListener('close', () => { dlg.innerHTML = ''; });
  dlg.addEventListener('click', e => { if (e.target === dlg) closeVideo(); });

  function renderText(k) {
    const b = B(k); if (!b) return;
    const d = course[k];
    setHTML(b, d ? '<p class="read lg">' + rich(d.text) + '</p>' : pend(k, 'b'));
  }

  function renderRiddle() {
    const b = B('riddle'); if (!b) return;
    const r = course.riddle;
    if (!r) { setHTML(b, pend('riddle', 'b')); return; }
    setHTML(b, '<p class="read">' + rich(r.q) + '</p>'
      + (ui.riddle ? '<p class="answer">' + rich(r.a) + '</p>' : '<button class="txtbtn" type="button" data-act="riddle">הצגת התשובה</button>'));
  }

  function renderJoke() {
    const b = B('joke'); if (!b) return;
    const j = course.joke;
    if (!j) { setHTML(b, pend('joke', 'b')); return; }
    setHTML(b, '<p class="read">' + rich(j.setup) + '</p>'
      + (j.punch ? (ui.joke ? '<p class="punch">' + rich(j.punch) + '</p>' : '<button class="txtbtn" type="button" data-act="joke">והתשובה?</button>') : ''));
  }

  /* songs: existing ones, checked against Apple's catalogue, with credits */
  function songItem(it) {
    const f = it.found || null;
    const title = f ? f.title : it.title, artist = f ? f.artist : it.artist;
    const years = [f && f.year, it.year].map(Number).filter(y => y > 1000);
    const year = years.length ? String(Math.min(...years)) : ''; /* a re-release is never older than the original */
    const q = enc(title + ' ' + artist);
    const by = ['<bdi>' + esc(artist) + '</bdi>', it.writer && it.writer !== artist ? 'כתיבה: <bdi>' + esc(it.writer) + '</bdi>' : '', esc(year)].filter(Boolean).join(' · ');
    const links = '<p class="song-links">'
      + (f && f.url ? out(f.url, 'ב-Apple Music') : '')
      + out('https://www.youtube.com/results?search_query=' + q, f ? 'ביוטיוב' : 'להאזנה ביוטיוב')
      + out('https://open.spotify.com/search/' + q, 'ב-Spotify') + '</p>';
    const head = '<p class="song-t">' + esc(title) + '</p><p class="song-by">' + by + '</p>';
    const why = it.why ? '<p class="song-why">' + rich(it.why) + '</p>' : '';
    const act = f && f.preview ? '<div class="song-act">' + playBtn('listen sm', f.preview, '', 'האזנה לקטע') + links + '</div>' : links;
    if (f && f.artwork) {
      return '<div class="songi has-cover"><img class="cover" src="' + esc(f.artwork) + '" alt="" loading="lazy"><div class="song-main">' + head + '</div>' + why + act + '</div>';
    }
    return '<div class="songi">' + head + why + act + '</div>';
  }
  function renderSong() {
    const b = B('song'); if (!b) return;
    const s = course.song;
    if (!s || !arr(s.items).length) { M('song', ''); setHTML(b, pend('song', 'b')); return; }
    const items = s.items;
    /* when the catalogue knows some of the songs, show only those */
    const show = items.some(it => it.found) ? items.filter(it => it.found !== false) : items;
    M('song', show.length === 1 ? 'שיר קיים' : show.length + ' שירים קיימים');
    setHTML(b, show.map(songItem).join(''));
  }

  /* podcast: existing episodes to play here, the AI's draft for a personal episode, and shows worth knowing */
  function epItem(e) {
    const mins = e.duration ? Math.max(1, Math.round(e.duration / 60)) + ' דק׳' : '';
    return '<div class="ep">'
      + (e.artwork ? '<img class="cover sm" src="' + esc(e.artwork) + '" alt="" loading="lazy">' : '<span class="cover sm" aria-hidden="true"></span>')
      + '<div class="ep-t">' + (e.url ? out(e.url, e.title) : '<b>' + esc(e.title) + '</b>')
      + '<small>' + (e.show ? '<bdi>' + esc(e.show) + '</bdi>' : '') + (e.show && mins ? ' · ' : '') + mins + '</small></div>'
      + playBtn('sq', e.audio, 'האזנה לפרק: ' + e.title) + '</div>';
  }
  function recItem(r) {
    const f = r.found || null;
    const note = [r.lang, r.why].filter(Boolean).join(' · ');
    const link = out(f && f.url ? f.url : 'https://open.spotify.com/search/' + enc(r.name), f ? f.name : r.name) + (note ? '<span class="note">' + esc(note) + '</span>' : '');
    return f && f.artwork ? '<li class="has-cover"><img class="cover sm" src="' + esc(f.artwork) + '" alt="" loading="lazy"><div>' + link + '</div></li>' : '<li>' + link + '</li>';
  }
  function renderPodcast() {
    const b = B('podcast'); if (!b) return;
    const p = course.podcast;
    M('podcast', planMin('podcast'));
    const soon = '<p class="soon-note">פודקאסט אישי בקולות אמיתיים ייווצר בקרוב...</p>';
    if (!p) { setHTML(b, soon + pend('podcast', 'b')); return; }
    const eps = arr(p.episodes);
    let draft = '<p class="pod-title">' + esc(p.title) + '</p>' + soon;
    if (p.script.length) {
      if (canSpeak) {
        draft += '<button class="listen" type="button" data-act="speak" aria-pressed="' + ui.speaking + '">'
          + (ui.speaking ? ICON.stop + 'עצירת ההאזנה' : ICON.play + 'האזנה לטיוטה בקול מחשב') + '</button>';
      }
      if (ui.noVoice) draft += '<p class="muted small">במכשיר הזה לא מותקן קול בעברית, אז בינתיים אפשר לקרוא את התסריט.</p>';
      draft += '<details class="script"' + (ui.scriptOpen ? ' open' : '') + '><summary>תסריט הפרק · ' + p.script.length + ' שורות</summary><ol>'
        + p.script.map((l, k) => '<li data-line="' + k + '"><b>' + esc(l.s) + '</b>' + rich(l.l) + '</li>').join('') + '</ol></details>';
    }
    let html = eps.length
      ? '<div class="eplist"><p class="mini-h">פרקים קיימים על הנושא</p>' + eps.map(epItem).join('') + '</div><div class="sub"><p class="mini-h">טיוטה לפרק אישי</p>' + draft + '</div>'
      : draft;
    const recs = arr(p.recs);
    const shown = recs.some(r => r.found) ? recs.filter(r => r.found !== false) : recs;
    if (shown.length) html += '<div class="sub"><p class="mini-h">פודקאסטים קיימים שכדאי להכיר</p><ul class="links">' + shown.map(recItem).join('') + '</ul></div>';
    setHTML(b, html);
    if (ui.speaking) markLine();
  }

  function renderSources() {
    const b = B('sources'); if (!b) return;
    const s = course.sources;
    const t = course.title || course.topic;
    const en = (s && s.en) || course.en || t;
    setHTML(b, '<ul class="links">'
      + ext('https://he.wikipedia.org/w/index.php?search=' + enc(t), 'הערך בוויקיפדיה', 'עברית')
      + ext('https://scholar.google.com/scholar?q=' + enc(en), 'מאמרים אקדמיים', 'Google Scholar')
      + ext('https://www.khanacademy.org/search?page_search_query=' + enc(en), 'שיעורים מוסברים', 'Khan Academy')
      + '</ul>'
      + (s && s.orgs.length
        ? '<div class="sub"><p class="mini-h">גופים מקצועיים בתחום</p><ul class="links">' + s.orgs.map(o => ext('https://www.google.com/search?q=' + enc(o.name + ' ' + en), o.name, o.why)).join('') + '</ul></div>'
        : (building('b') ? sk(PENDING.sources, 2) : '')));
  }

  function renderNotes() {
    const b = B('notes'); if (!b) return;
    const key = 'sakran:notes:' + course.topic.trim().toLowerCase();
    b.innerHTML = '<label class="sr" for="notesBox">ההערות שלי</label>'
      + '<textarea id="notesBox" rows="5" placeholder="מה חשוב לכם לזכור מהנושא?"></textarea>'
      + '<p class="muted small" id="notesState">ההערות נשמרות בדפדפן הזה בלבד.</p>';
    const ta = $('#notesBox');
    ta.value = store.get(key) || '';
    let tmo = 0;
    ta.addEventListener('input', () => {
      clearTimeout(tmo);
      tmo = setTimeout(() => { store.set(key, ta.value); const st = $('#notesState'); if (st) st.textContent = 'נשמר בדפדפן הזה.'; }, 400);
    });
  }

  /* ---------- illustrations ---------- */
  /* An svg from Claude is shown only through <img>, where scripts and outside files never run; the checks below are extra care. */
  const ART_SLOTS = ['img1', 'img2', 'img3'];
  function cleanSvg(s) {
    s = String(s || '');
    const i = s.indexOf('<svg'), j = s.lastIndexOf('</svg>');
    if (i < 0 || j < i) return '';
    s = s.slice(i, j + 6);
    if (s.length > 30000 || /<script|<foreignObject|\son\w+\s*=/i.test(s)) return '';
    const hrefs = s.match(/href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi) || [];
    if (hrefs.some(h => !/=\s*["']?\s*#/.test(h))) return '';
    if (!/xmlns\s*=/.test(s)) s = s.replace('<svg', "<svg xmlns='http://www.w3.org/2000/svg'");
    return s;
  }
  const svgUrl = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  function renderArt(i) {
    const k = ART_SLOTS[i], b = B(k), cell = $('#t-' + k);
    if (!b || !cell) return;
    const a = arr(course.art)[i];
    const wide = i === 1 ? ' wide' : '';
    if (!a || !a.svg) {
      if (building('c')) { cell.hidden = false; setHTML(b, '<div class="art-wait' + wide + '"><span>מציירים איור...</span></div>'); }
      else { cell.hidden = true; setHTML(b, ''); }
      return;
    }
    cell.hidden = false;
    setHTML(b, '<figure class="fig"><img class="art' + wide + '" src="' + esc(svgUrl(a.svg)) + '" alt="' + esc(a.caption ? 'איור: ' + plain(a.caption) : 'איור') + '">'
      + (a.caption ? '<figcaption class="figcap"><b>איור</b>' + esc(plain(a.caption)) + '</figcaption>' : '') + '</figure>');
  }

  /* ---------- photos, with the photographer and the license ---------- */
  function renderPhoto(i) {
    const k = PHOTO_SLOTS[i], b = B(k), cell = $('#t-' + k);
    if (!b || !cell) return;
    const p = arr(course.photos)[i];
    if (!p) { cell.hidden = true; setHTML(b, ''); return; }
    cell.hidden = false;
    const name = str(p.title).replace(/^[^:]{1,20}:/, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ');
    const lic = p.license ? (p.licenseUrl ? out(p.licenseUrl, p.license) : esc(p.license)) : '';
    const where = p.page ? out(p.page, 'ויקישיתוף') : 'ויקישיתוף';
    setHTML(b, '<figure class="fig"><img class="photo" src="' + esc(p.src) + '" alt="' + esc(name ? 'תמונה: ' + name : 'תמונה') + '" loading="lazy">'
      + '<figcaption class="figcap credit"><b>תמונה</b>' + (p.author ? '<bdi>' + esc(p.author) + '</bdi> · ' : '') + (lic ? lic + ' · ' : '') + where + '</figcaption></figure>');
  }

  const R = {
    feed: renderFeed, quiz: renderQuiz, video: renderVideo, podcast: renderPodcast,
    fact: () => renderText('fact'), spicy: () => renderText('spicy'),
    riddle: renderRiddle, joke: renderJoke, song: renderSong, sources: renderSources,
    img1: () => renderArt(0), img2: () => renderArt(1), img3: () => renderArt(2),
    ph1: () => renderPhoto(0), ph2: () => renderPhoto(1), ph3: () => renderPhoto(2)
  };
  function renderAll() { Object.keys(R).forEach(k => R[k]()); }

  function openCourse(c) {
    abortGen(); stopSpeech(true); audioStop(); closeVideo(); stopPlaceholder();
    course = c; ui = freshUI(); view = 'course';
    $('#home').hidden = true; $('#course').hidden = false;
    $('#doneBanner').hidden = true;
    $('#cTitle').textContent = '';
    setStatus('none');
    buildShells(); renderHead(); renderAll(); renderNotes();
    timerReset(c.minutes);
    window.scrollTo(0, 0);
  }
  function openReady(c) { openCourse(c); timerStart(); wantMedia(c); }
  function goHome() {
    abortGen();
    stopSpeech(true); audioStop(); closeVideo(); timerPause();
    view = 'home'; course = null;
    $('#course').hidden = true; $('#home').hidden = false;
    refreshResume(); startPlaceholder(); window.scrollTo(0, 0);
  }
  function refreshResume() {
    const last = store.get('sakran:last');
    const btn = $('#resumeBtn');
    if (last && arr(last.chapters).length) { btn.textContent = 'להמשיך: ' + (last.title || last.topic); btn.hidden = false; }
    else btn.hidden = true;
  }

  function goCh(d) {
    if (!course) return;
    const i = ui.ch + d;
    if (i < 0 || i >= course.chapters.length) return;
    ui.ch = i; renderFeed();
    const t = $('#t-feed');
    if (t && t.getBoundingClientRect().top < 110) t.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
  }

  /* ---------- timer, drawn on the time line ---------- */
  const timer = { total: 600, left: 600, running: false, last: 0, id: 0, ended: false };
  function timerReset(min) { timerPause(); timer.total = timer.left = min * 60; timer.ended = false; drawTimer(); }
  function timerStart() {
    if (timer.running || timer.left <= 0 || view !== 'course') return;
    timer.running = true; timer.last = Date.now();
    timer.id = setInterval(tick, 500); drawTimer();
  }
  function timerPause() { timer.running = false; clearInterval(timer.id); drawTimer(); }
  function tick() {
    const now = Date.now();
    timer.left = Math.max(0, timer.left - (now - timer.last) / 1000); timer.last = now;
    if (timer.left <= 0) { timerPause(); timer.ended = true; showDone(); }
    drawTimer();
  }
  function drawTimer() {
    const r = $('#tRead'); if (!r) return;
    r.textContent = fmt(timer.left);
    const frac = timer.total ? Math.min(1, 1 - timer.left / timer.total) : 0;
    $('#tlFill').style.width = (frac * 100) + '%';
    $('#tlNow').style.insetInlineStart = 'calc(' + (frac * 100) + '% - 1px)';
    const t = $('#tToggle');
    t.innerHTML = timer.running ? ICON.pause : ICON.play;
    t.setAttribute('aria-label', timer.running ? 'השהיית הטיימר' : 'הפעלת הטיימר');
    t.disabled = timer.left <= 0;
  }
  function showDone() {
    const el = $('#doneBanner');
    el.innerHTML = '<p><b>עברו ' + Math.round(timer.total / 60) + ' דקות.</b>כל הכבוד על הזמן שהקדשתם ללמידה.</p>'
      + '<div class="row"><button class="txtbtn" type="button" data-act="plus5">עוד 5 דקות</button><button class="btn-ink" type="button" data-act="home">קורס חדש</button></div>';
    el.hidden = false;
  }

  /* ---------- podcast draft, read aloud by the device ---------- */
  const canSpeak = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  let speakRun = 0;
  if (canSpeak) { try { speechSynthesis.getVoices(); speechSynthesis.addEventListener('voiceschanged', () => {}); } catch (e) {} }
  function heVoices() { try { return speechSynthesis.getVoices().filter(v => /^(he|iw)\b/i.test(v.lang || '')); } catch (e) { return []; } }
  function markLine() { D.querySelectorAll('#b-podcast li[data-line]').forEach(li => li.classList.toggle('now', Number(li.dataset.line) === ui.line)); }
  function toggleSpeak() {
    const p = course && course.podcast;
    if (!p || !p.script.length) return;
    if (ui.speaking) { stopSpeech(); return; }
    const vs = heVoices();
    if (!vs.length) { ui.noVoice = true; ui.scriptOpen = true; renderPodcast(); return; }
    audioStop();
    const run = ++speakRun;
    const hosts = [];
    p.script.forEach(l => { if (!hosts.includes(l.s)) hosts.push(l.s); });
    ui.speaking = true; ui.line = 0; ui.scriptOpen = true; renderPodcast();
    const next = () => {
      if (run !== speakRun || !ui.speaking) return;
      if (ui.line >= p.script.length) { ui.speaking = false; ui.line = -1; renderPodcast(); return; }
      markLine();
      const l = p.script[ui.line];
      const h = Math.max(0, hosts.indexOf(l.s));
      const u = new SpeechSynthesisUtterance(plain(l.l));
      u.voice = vs[h % vs.length]; u.lang = u.voice.lang || 'he-IL';
      if (vs.length < 2) u.pitch = h % 2 ? 0.85 : 1.15;
      u.rate = 1.02;
      u.onend = () => { if (run !== speakRun) return; ui.line++; next(); };
      u.onerror = () => { if (run !== speakRun) return; ui.speaking = false; ui.line = -1; renderPodcast(); };
      try { speechSynthesis.speak(u); } catch (e) { ui.speaking = false; renderPodcast(); }
    };
    next();
  }
  function stopSpeech(silent) {
    speakRun++;
    const was = ui.speaking;
    ui.speaking = false; ui.line = -1;
    if (canSpeak) { try { speechSynthesis.cancel(); } catch (e) {} }
    if (was && !silent && course) renderPodcast();
  }

  /* ---------- home form ---------- */
  const form = $('#askForm');
  const input = $('#topic');

  /* the minute ruler */
  const STOPS = [5, 10, 15, 30];
  function buildRuler() {
    let html = '<span class="r-fill" id="rFill"></span>';
    for (let m = 0; m <= 30; m++) {
      const cls = STOPS.includes(m) ? 'tick stop' : (m % 5 === 0 ? 'tick m5' : 'tick');
      html += '<i class="' + cls + '" style="--p:' + (m / 30 * 100).toFixed(3) + '%"></i>';
    }
    html += '<span class="r-base"></span>';
    $('#rTrack').innerHTML = html;
    syncRuler();
  }
  function syncRuler() { const v = Number(form.elements.namedItem('min').value) || 10; $('#rFill').style.width = (v / 30 * 100) + '%'; }
  form.addEventListener('change', e => { if (e.target.name === 'min') syncRuler(); });
  $('#ruler').addEventListener('click', e => {
    if (e.target.closest('label')) return;
    const r = $('#rTrack').getBoundingClientRect();
    const m = (r.right - e.clientX) / r.width * 30;
    const best = STOPS.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
    const inp = $('#m' + best); inp.checked = true; inp.focus({ preventScroll: true }); syncRuler();
  });
  buildRuler();

  /* placeholder that types example topics */
  const EXAMPLES = ['חורים שחורים', 'איך עובד הלב', 'ההיסטוריה של הפיצה', 'למה השמיים כחולים', 'הרנסנס באיטליה', 'איך עובדת בורסה', 'מחזור המים בטבע'];
  let ph = { i: 0, c: 0, dir: 1, t: 0 };
  function typePh() {
    const w = EXAMPLES[ph.i];
    ph.c += ph.dir;
    input.placeholder = w.slice(0, Math.max(0, ph.c)) || ' ';
    let delay = 75;
    if (ph.dir > 0 && ph.c >= w.length) { ph.dir = -1; delay = 1800; }
    else if (ph.dir < 0 && ph.c <= 0) { ph.dir = 1; ph.i = (ph.i + 1) % EXAMPLES.length; delay = 350; }
    else if (ph.dir < 0) delay = 32;
    ph.t = setTimeout(typePh, delay);
  }
  function startPlaceholder() { stopPlaceholder(); if (reduced()) { input.placeholder = 'כל נושא שבעולם'; return; } ph = { i: ph.i, c: 0, dir: 1, t: 0 }; ph.t = setTimeout(typePh, 600); }
  function stopPlaceholder() { clearTimeout(ph.t); }

  function formMsg(html) { const m = $('#formMsg'); if (!html) { m.hidden = true; m.innerHTML = ''; return; } m.innerHTML = html; m.hidden = false; }
  const NOT_READY = '<span>' + esc(ERR.not_configured) + '</span><button class="txtbtn" type="button" data-act="sample">לקורס המוכן</button>';
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const topic = input.value.trim().replace(/\s+/g, ' ');
    if (!topic) { formMsg('כתבו נושא שתרצו ללמוד.'); input.focus(); return; }
    formMsg('');
    const minutes = Number(form.elements.namedItem('min').value) || 10;
    const level = form.elements.namedItem('lvl').value || 'all';
    const cta = $('#ctaBtn');
    cta.disabled = true; $('#ctaLabel').textContent = 'רגע...';
    try {
      await serverReady;
      if (server.known && !server.ai) { formMsg(NOT_READY); return; }
      if (server.accessCode) {
        const code = accessCode();
        if (!code) { formMsg('כתבו את קוד הגישה שקיבלתם.'); codeInput.focus(); return; }
        const r = await getJSON('/api/status', { cache: 'no-store', headers: { 'x-access-code': enc(code) } });
        if (r.error === 'rate_limited') { formMsg(esc(ERR.rate_limited)); return; }
        if (r.codeOk === false) { formMsg('קוד הגישה לא נכון.'); codeInput.focus(); codeInput.select(); return; }
        store.set('sakran:code', code);
      }
    } finally {
      cta.disabled = false; $('#ctaLabel').textContent = 'בנו לי קורס';
    }
    build(topic, minutes, level);
  });

  /* ---------- clicks ---------- */
  D.addEventListener('click', e => {
    const idea = e.target.closest('[data-topic]');
    if (idea) { input.value = idea.dataset.topic; formMsg(''); input.focus(); return; }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'sample') { openReady(JSON.parse(JSON.stringify(SAMPLE))); return; }
    if (act === 'resume') { const last = store.get('sakran:last'); if (last) openReady(Object.assign(newCourse(last.topic, last.minutes, last.level), last)); return; }
    if (act === 'home') { goHome(); if (el.dataset.focus === 'code') { $('#codeRow').hidden = false; codeInput.focus(); } return; }
    if (act === 'vclose') { closeVideo(); return; }
    if (!course) return;
    switch (act) {
      case 'prev': goCh(-1); break;
      case 'next': goCh(1); break;
      case 'toquiz': { const q = $('#t-quiz'); if (q) q.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); break; }
      case 'qpick': { const it = course.quiz[ui.quiz.i]; if (ui.quiz.picked != null) break; ui.quiz.picked = Number(el.dataset.k); if (ui.quiz.picked === it.a) ui.quiz.score++; renderQuiz(); break; }
      case 'qnext': { if (ui.quiz.i + 1 < course.quiz.length) { ui.quiz.i++; ui.quiz.picked = null; } else ui.quiz.done = true; renderQuiz(); break; }
      case 'qreset': ui.quiz = { i: 0, picked: null, score: 0, done: false }; renderQuiz(); break;
      case 'riddle': ui.riddle = true; renderRiddle(); break;
      case 'joke': ui.joke = true; renderJoke(); break;
      case 'speak': toggleSpeak(); break;
      case 'aplay': audioToggle(el.dataset.src); break;
      case 'vopen': openVideo(Number(el.dataset.k) || 0); break;
      case 'ttoggle': if (timer.running) timerPause(); else timerStart(); break;
      case 'plus5': timer.total += 300; timer.left += 300; timer.ended = false; $('#doneBanner').hidden = true; timerStart(); break;
      case 'stop': if (gen) { gen.stopped = true; gen.ctls.forEach(a => { try { a.abort(); } catch (err) {} }); } break;
      case 'retry': build(course.topic, course.minutes, course.level); break;
    }
  });
  D.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('details.script')) ui.scriptOpen = e.target.open; }, true);
  D.addEventListener('keydown', e => {
    if (view !== 'course' || dlg.open || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowLeft') { goCh(1); }
    else if (e.key === 'ArrowRight') { goCh(-1); }
  });

  /* ---------- start ---------- */
  refreshResume();
  startPlaceholder();
})();
