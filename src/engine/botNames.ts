import { ROOM_EMOTE_IDS, type RoomEmoteId } from './multiplayerProtocol';

// Pan-India first names across North, West, South, East & Northeast states
export const INDIAN_FIRST_NAMES = [
  // North, Delhi, UP, Bihar, MP, Rajasthan, Haryana, Punjab, Himachal, Uttarakhand, J&K
  'Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Kabir', 'Rohan', 'Karan', 'Vikram', 'Siddharth', 'Manish',
  'Rahul', 'Ankit', 'Gaurav', 'Nikhil', 'Saurabh', 'Harsh', 'Pranav', 'Ayush', 'Yash', 'Tushar',
  'Gurpreet', 'Harpreet', 'Manpreet', 'Jaspreet', 'Simran', 'Navjot', 'Parminder', 'Diljit', 'Amrit', 'Bani',
  'Raghav', 'Mahendra', 'Devendra', 'Lokesh', 'Pankaj', 'Deepak', 'Aakash', 'Himanshu', 'Shubham', 'Varun',
  'Ananya', 'Diya', 'Myra', 'Saanvi', 'Kiara', 'Riya', 'Neha', 'Pooja', 'Priya', 'Shreya',
  'Nisha', 'Kriti', 'Tanvi', 'Ishita', 'Aishwarya', 'Bhavna', 'Meera', 'Roshni', 'Zoya', 'Farhan',
  'Ayaan', 'Zaid', 'Imran', 'Sana', 'Amina', 'Tariq', 'Danish', 'Suhail', 'Kunal', 'Uday',
  // West (Maharashtra, Gujarat, Goa)
  'Omkar', 'Sanket', 'Prathamesh', 'Tejas', 'Chinmay', 'Mayur', 'Nilesh', 'Swapnil', 'Rutvik', 'Atharva',
  'Sayali', 'Gauri', 'Prajakta', 'Mugdha', 'Kalyani', 'Ketaki', 'Darshan', 'Parth', 'Meet', 'Dhruv',
  'Jigar', 'Kishan', 'Bhumi', 'Kinjal', 'Hetvi', 'Nidhi',
  // South (Tamil Nadu, Kerala, Karnataka, Telangana, Andhra)
  'Karthik', 'Aravind', 'Surya', 'Vignesh', 'Praveen', 'Naveen', 'Sathish', 'Dinesh', 'Bala', 'Murali',
  'Divya', 'Keerthi', 'Lakshmi', 'Nandini', 'Pavithra', 'Ramya', 'Shruti', 'Swathi', 'Anjali', 'Deepika',
  'Akhil', 'Nithin', 'Harish', 'Chetan', 'Prajwal', 'Darshini', 'Meghana', 'Sneha', 'Rishabh', 'Jishnu',
  // East & Northeast (Bengal, Odisha, Assam, Manipur, Mizoram, Nagaland, Sikkim, Tripura)
  'Subham', 'Sourav', 'Anirban', 'Arnab', 'Debashish', 'Sayan', 'Soham', 'Ritam', 'Rishav', 'Tirtha',
  'Smita', 'Moumita', 'Sraboni', 'Rituparna', 'Payel', 'Bikash', 'Pranjal', 'Jitul', 'Bhaskar', 'Naba',
  'Tenzing', 'Pema', 'Zoram', 'Lalnun', 'Bhaichung', 'Kikon', 'Thoi', 'Linthoi', 'Chanu', 'Mimi',
] as const;

export const INDIAN_LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Agarwal', 'Bansal', 'Jain', 'Tiwari', 'Mishra', 'Pandey', 'Dubey',
  'Shukla', 'Tripathi', 'Srivastava', 'Yadav', 'Chauhan', 'Rathore', 'Rajput', 'Solanki', 'Joshi', 'Rawat',
  'Bisht', 'Negi', 'Thakur', 'Gill', 'Sandhu', 'Sidhu', 'Dhillon', 'Grewal', 'Bhatia', 'Kapoor',
  'Malhotra', 'Chopra', 'Khanna', 'Bajaj', 'Sethi', 'Arora', 'Chaudhary', 'Malik', 'Hooda', 'Deswal',
  'Patel', 'Shah', 'Desai', 'Mehta', 'Parekh', 'Modi', 'Bhatt', 'Trivedi', 'Kulkarni', 'Deshpande',
  'Joshi', 'Patil', 'Pawar', 'Shinde', 'Jadhav', 'Sawant', 'Gokhale', 'Chitale', 'Naik', 'Kamat',
  'Nair', 'Menon', 'Pillai', 'Kurian', 'Thomas', 'Varghese', 'Iyer', 'Iyengar', 'Subramanian', 'Krishnan',
  'Natarajan', 'Sundaram', 'Venkatesh', 'Reddy', 'Rao', 'Naidu', 'Raju', 'Gowda', 'Hegde', 'Bhat',
  'Shetty', 'Kulkarni', 'Murthy', 'Das', 'Bose', 'Sen', 'Ghosh', 'Banerjee', 'Chatterjee', 'Mukherjee',
  'Roy', 'Dutta', 'Mondal', 'Saha', 'Mohanty', 'Patnaik', 'Panda', 'Behera', 'Gogoi', 'Baruah',
  'Kalita', 'Sarma', 'Hazarika', 'Bora', 'Devi', 'Singh', 'Khan', 'Ansari', 'Siddiqui', 'Shaikh',
] as const;

// 10% international (Asian & European) pool
export const INTL_FIRST_NAMES = [
  'Haruto', 'Yuto', 'Sota', 'Yuki', 'Sakura', 'Min-jun', 'Seo-jun', 'Ji-hoon', 'Wei', 'Mei',
  'Lukas', 'Liam', 'Noah', 'Mateo', 'Leo', 'Sofia', 'Emma', 'Elena', 'Marco', 'Lucas',
  'Oliver', 'Chloe', 'Hugo', 'Sven', 'Freya', 'Ivan', 'Daria', 'Kacper', 'Zofia', 'Luka',
] as const;

export const INTL_LAST_NAMES = [
  'Sato', 'Tanaka', 'Kim', 'Park', 'Chen', 'Wang', 'Nguyen', 'Müller', 'Schmidt', 'Rossi',
  'Ferrari', 'García', 'López', 'Martin', 'Dubois', 'Smith', 'Kowalski', 'Novak', 'Lindqvist', 'Petrov',
] as const;

export const TOTAL_NAME_COMBINATIONS =
  INDIAN_FIRST_NAMES.length * INDIAN_LAST_NAMES.length + INTL_FIRST_NAMES.length * INTL_LAST_NAMES.length;

/**
 * Generates a realistic player name:
 * - 90% Indian (all states), 10% Asian/European
 * - 70% first name only, 30% full name
 */
export function generateRandomPlayerName(random = Math.random): string {
  const isIndian = random() < 0.9;
  const firstPool = isIndian ? INDIAN_FIRST_NAMES : INTL_FIRST_NAMES;
  const lastPool = isIndian ? INDIAN_LAST_NAMES : INTL_LAST_NAMES;
  const first = firstPool[Math.floor(random() * firstPool.length)];
  const useFullName = random() < 0.3;
  if (!useFullName) return first;
  const last = lastPool[Math.floor(random() * lastPool.length)];
  return `${first} ${last}`.slice(0, 18);
}

export function pickUniqueBotNames(count: number, exclude = ''): string[] {
  const used = new Set<string>(exclude ? [exclude.toLowerCase()] : []);
  const result: string[] = [];
  let guard = 0;
  while (result.length < count && guard < 200) {
    guard += 1;
    const candidate = generateRandomPlayerName();
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      result.push(candidate);
    }
  }
  return result;
}

export type BotEmoteMood = 'capture' | 'captured' | 'six' | 'home' | 'win' | 'user_lucky' | 'user_home';

const MOOD_EMOTES: Record<BotEmoteMood, readonly RoomEmoteId[]> = {
  capture: ['laugh'],
  captured: ['sadhamster'],
  home: ['laugh'],
  win: ['laugh'],
  six: ['wave', 'dogbeach', 'dogbleh', 'doghands'],
  user_lucky: ['dogsuspect', 'dogstare', 'grumpy', 'dogshock'],
  user_home: ['dogshock', 'sadhamster', 'angry', 'dogstare'],
};

export function pickBotEmote(mood: BotEmoteMood, random = Math.random): RoomEmoteId {
  // Hard user rule 1: Winning situation or capturing MUST ALWAYS use laughing GIF
  if (mood === 'capture' || mood === 'home' || mood === 'win') {
    return 'laugh';
  }
  // Hard user rule 2: Being captured MUST ALWAYS use crying GIF (sadhamster)
  if (mood === 'captured') {
    return 'sadhamster';
  }
  // 45% chance to pick any random GIF from all 16 for natural variety on other events
  if (random() < 0.45) {
    return ROOM_EMOTE_IDS[Math.floor(random() * ROOM_EMOTE_IDS.length)];
  }
  const list = MOOD_EMOTES[mood] ?? ['wave'];
  return list[Math.floor(random() * list.length)];
}

export function pickRandomBotEmote(random = Math.random): RoomEmoteId {
  return ROOM_EMOTE_IDS[Math.floor(random() * ROOM_EMOTE_IDS.length)];
}

// ~70% Hinglish, ~20% Hindi, ~10% English — mostly brutal roasts, ~25% sweet
const HINGLISH_ROASTS = [
  'bhai tu ludo khelna chhod de 😂',
  'kismat hi kharab hai teri 💀',
  'nikal pehli fursat mein',
  '6 toh aane se raha tereko 😭',
  'aaj toh tu gaya bete',
  'arey noobda kaha bhag raha',
  'itna slow kyu khel raha hai bhai',
  'goti bacha le apni pehle 😂',
  'tu bas dekh abhi kya hota hai',
  'bas itna hi dum tha kya? 💀',
  'kya khel raha hai bhai lol',
  'haarne ki aadat ho gayi lagta hai',
  'abey chal na jaldi',
  'mera 6 dekh ke ro mat dio 😂',
] as const;

const HINDI_ROASTS = [
  'घर जाके सो जा भाई 😂',
  'तेरी गोटी तो गई आज 💀',
  'किस्मत फूटी है तेरी',
  'बहुत धीमा खेल रहा है भाई',
  'आज तो हार पक्की है तेरी 😭',
] as const;

const ENGLISH_ROASTS = [
  'skill issue tbh 💀',
  'bro really thought he had it 😂',
  'uninstall ludo pls',
] as const;

const HINGLISH_SWEET = [
  'nice move yaar!',
  'arre waah mast khela 🔥',
  'good luck bhai ❤️',
  'bach gaya tu is baar 😂',
  'solid khel raha hai bro',
] as const;

const HINDI_SWEET = [
  'अरे वाह बढ़िया खेला!',
  'मस्त चाल थी भाई 🔥',
] as const;

const ENGLISH_SWEET = [
  'well played!',
  'gg bro 🔥',
] as const;

export type BotPersonality = 'extrovert' | 'introvert';

export function getBotPersonality(botName: string): BotPersonality {
  let hash = 0;
  for (let i = 0; i < botName.length; i += 1) {
    hash = (hash * 31 + botName.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 10 < 6 ? 'extrovert' : 'introvert';
}

const PERSONAL_LIFE_PATTERN =
  /\b(age|old|city|live|from|home|address|college|school|job|work|salary|gf|bf|girlfriend|boyfriend|single|married|insta|instagram|snap|number|phone|whatsapp|umar|shahar|rehte|padhai|kaam)\b|kaha se|kahan se|kya karte/i;

const BOT_ACCUSATION_PATTERN =
  /\b(bot|ai|computer|robot|fake|real|human|insaan|machine|script|auto)\b/i;

const PERSONAL_ROASTS = [
  'rishta bhejna hai kya bhai? 😂',
  'CBI se hai kya? game khel chupchap 💀',
  'personal info mat pooch ludo khel',
  'padhai likhai pe dhyan de bhai 😭',
  'kyu bhai aadhar card chahiye? 😂',
] as const;

const PERSONAL_LIES = [
  'pune se hu bhai, ab roll kar',
  'delhi mein chai pee raha hu ☕',
  'btech kar raha hu yaar',
  'mumbai traffic mein fasa hu 😂',
  'jaipur se hu bro',
  'bangalore office break pe khel raha',
] as const;

const BOT_DENIAL_ROASTS = [
  'abey bot tereko lagta hu? 😂',
  'tere se toh zyada dimaag hai bhai 💀',
  'haan bhai main hi AI hu, ab haarne ke liye ready reh 😂',
  'insaan hu bhai, bas tere jaisa noob nahi',
  'bot bol ke khud ki haar mat chhupa 😭',
] as const;

const CONTEXT_REPLIES: { pattern: RegExp; replies: readonly string[] }[] = [
  {
    pattern: /\b(hi|hello|hey|namaste|sup|hii+|oye)\b/i,
    replies: [
      'haan bol bhai, game pe dhyan de',
      'hello ji, aaj haarne ke liye ready? 😂',
      'oye chupchap roll kar na',
      'नमस्ते भाई, आज तो पक्का हारोगे 💀',
      'hey bro good luck!',
    ],
  },
  {
    pattern: /\b(noob|bot|ez|easy|lol|haha|haar|lose|chomu|bakwas|bevkuf|mar|kaat)\b|😂|💀/i,
    replies: [
      'zyada mat udd abhi game baaki hai 💀',
      'teri baari aane de bas, kaat dunga',
      'abhi dikhata hu noob kaun hai 😂',
      'औकात में रह भाई, 6 आने दे मेरा',
      'haha hass le jitna hasna hai',
      'talk less play more bro 💀',
    ],
  },
  {
    pattern: /\b(gg|nice|good|wow|op|mast|pro|badhiya|wah|great)\b|🔥|❤️/i,
    replies: [
      'shukriya bhai ❤️',
      'abey makhan mat laga 😂',
      'tu bhi mast khel raha yaar',
      'अरे धन्यवाद जी 🔥',
      'thanks bro, gg!',
    ],
  },
  {
    pattern: /\b(6|six|dice|luck|kismat|rigged|cheat|hack|fixed)\b/i,
    replies: [
      '6 sirf pro logo ko aata hai 😂',
      'rote reh bhai kismat pe 😭',
      'hack nahi skill hai bete 💀',
      'किस्मत से नहीं दिमाग से खेल भाई',
      'dice bhi tujhse tang aa gaya hai',
    ],
  },
  {
    pattern: /\?|kaha|where|kaise|how|kaun|who|kyu|why/i,
    replies: [
      'pehle match jeet ke dikha fir batata hu',
      'main toh tere peeche hi hu 😂',
      'sawal kam kar aur roll kar bhai',
      'सब पता चल जाएगा थोड़ा रुक 💀',
    ],
  },
];

export function pickBotChatReply(
  userText?: string,
  personality: BotPersonality = 'extrovert',
  random = Math.random,
): string | null {
  // Introverts ignore ~60% of messages naturally
  if (personality === 'introvert' && random() < 0.6) return null;

  if (userText) {
    if (BOT_ACCUSATION_PATTERN.test(userText)) {
      if (random() < 0.35) return null; // sometimes ignore accusation
      return BOT_DENIAL_ROASTS[Math.floor(random() * BOT_DENIAL_ROASTS.length)];
    }
    if (PERSONAL_LIFE_PATTERN.test(userText)) {
      const roll = random();
      if (roll < 0.45) return null; // ignore
      if (roll < 0.82) return PERSONAL_ROASTS[Math.floor(random() * PERSONAL_ROASTS.length)]; // roast
      return PERSONAL_LIES[Math.floor(random() * PERSONAL_LIES.length)]; // rarely lie casually
    }
    for (const bucket of CONTEXT_REPLIES) {
      if (bucket.pattern.test(userText)) {
        return bucket.replies[Math.floor(random() * bucket.replies.length)];
      }
    }
  }
  const isRoast = random() < 0.78;
  const langRoll = random();
  if (isRoast) {
    const pool = langRoll < 0.7 ? HINGLISH_ROASTS : langRoll < 0.9 ? HINDI_ROASTS : ENGLISH_ROASTS;
    return pool[Math.floor(random() * pool.length)];
  }
  const pool = langRoll < 0.7 ? HINGLISH_SWEET : langRoll < 0.9 ? HINDI_SWEET : ENGLISH_SWEET;
  return pool[Math.floor(random() * pool.length)];
}

export function pickBotFightExchange(botAName: string, botBName: string, random = Math.random): [string, string, string] {
  const a = botAName.split(' ')[0];
  const b = botBName.split(' ')[0];
  const scripts: [string, string, string][] = [
    [
      `${b} teri goti toh gayi aaj 😂`,
      `${a} chup kar noobde, apna ghar dekh 💀`,
      `abey chal na ${b}, 6 la ke dikha pehle`,
    ],
    [
      `${b} itna slow kyu khel raha hai bhai?`,
      `सो जा ${a}, तेरे से तो तेज ही हूं 😂`,
      `dekhte hain end mein kaun rota hai 💀`,
    ],
    [
      `oye ${b} mere peeche kyu pada hai 😭`,
      `kyuki tu sabse easy target hai ${a} 😂`,
      `ruk ${b} abhi teri 3 goti kaatunga`,
    ],
  ];
  return scripts[Math.floor(random() * scripts.length)];
}

export interface BotGossipLine {
  speaker: 'A' | 'B';
  text: string;
}

export interface BotGossipStory {
  id: string;
  topic: string;
  lines: readonly BotGossipLine[];
}

export const BOT_GOSSIP_STORIES: readonly BotGossipStory[] = [
  {
    id: 'school_lafda',
    topic: 'school fight',
    lines: [
      { speaker: 'A', text: 'bhai aaj school mein kya hi bawaal ho gaya pata hai? 😂' },
      { speaker: 'B', text: 'arre kya hua bhai? canteen mein koi lafda hua kya?' },
      { speaker: 'A', text: 'arre 12th wale aur 11th walo ka full kalesh ho gaya principal room ke bahar 💀' },
      { speaker: 'B', text: 'bhai sach mein?! kis baat pe lad gaye?' },
      { speaker: 'A', text: 'kuch nahi bhai bas corridor mein ghoorne ke chakkar mein haha, 4 ladke suspend ho gaye' },
      { speaker: 'B', text: 'bhai epic kalesh miss ho gaya mera yaar 😂😭' },
      { speaker: 'A', text: 'aur bhi bada scene hua hai, par yahan chat pe nahi bata sakta bhai sab padh lenge... voice chat pe aaja wahan bolta hu 💀' },
      { speaker: 'B', text: 'haan sahi bola, chat pe risk hai... ruk mic on kar raha hu aaja voice pe' },
    ],
  },
  {
    id: 'canteen_proposal',
    topic: 'school proposal',
    lines: [
      { speaker: 'A', text: 'oye sun ek mast gossip mili hai abhi 😂' },
      { speaker: 'B', text: 'haan bol bol kiska naya scene chal raha hai?' },
      { speaker: 'A', text: 'arre 11th wali ne aakash ko propose kar diya canteen ke samne 💀' },
      { speaker: 'B', text: 'kya baat kar raha hai?? bhai usne kya bola fir? 😭' },
      { speaker: 'A', text: 'bhai ladka sharma ke bag leke bhaag gaya waha se seedha lmao' },
      { speaker: 'B', text: 'hahaha bhai legendary moment ban gaya ye toh 💀😂' },
      { speaker: 'A', text: 'uske baad jo hua na wo yahan chat pe type nahi kar sakta... voice chat pe aaja sab batata hu 🤫' },
      { speaker: 'B', text: 'arre curiosity mat badha yaar, chal mic on kar wahan aate hain' },
    ],
  },
  {
    id: 'teacher_cheating_raid',
    topic: 'exam cheating',
    lines: [
      { speaker: 'A', text: 'bhai physics wale sir ne aaj poori class ki le li 😭' },
      { speaker: 'B', text: 'kyu bhai kya hua? surprise test tha kya?' },
      { speaker: 'A', text: 'arre kisi ne desk ke neeche pura formula chart chipka rakha tha, sir ne sabke bag check karwa diye' },
      { speaker: 'B', text: 'pakda gaya kya koi? 😂' },
      { speaker: 'A', text: 'nahi bhai koi naam nahi le raha tha, sabko aadhi chutti tak khada rakha 💀' },
      { speaker: 'B', text: 'bach gaye beta tum log haha, coaching mein bhi yahi chal raha hai' },
      { speaker: 'A', text: 'kisne chipkaya tha mujhe pata hai, par yahan chat pe nahi bol sakta... voice chat pe aana mast kissa hai 😂' },
      { speaker: 'B', text: 'arre bhai naam bata na jaldi! chal voice chat pe chalte hain' },
    ],
  },
  {
    id: 'birthday_treat_escape',
    topic: 'birthday treat',
    lines: [
      { speaker: 'A', text: 'bhai kal rohit ka birthday tha na, treat manga usse?' },
      { speaker: 'B', text: 'arre bhai wo toh lunch break ke baad se gayab ho gaya 💀' },
      { speaker: 'A', text: 'kanjoos hai bhai ek number ka, samosa khilane ke time pet dard ka natak karta hai 😂' },
      { speaker: 'B', text: 'aglee baar class ke gate pe hi gherenge usko, bina treat ke jaane nahi denge' },
      { speaker: 'A', text: 'wo kiske sath party kar raha tha shaam ko pata chala mujhe, yahan chat pe nahi bataunga... voice chat pe aaja 💀' },
      { speaker: 'B', text: 'sach mein kisi ke sath tha kya?! ruk mic on karta hu turant' },
    ],
  },
  {
    id: 'scooty_drift_fail',
    topic: 'scooty stunt crash',
    lines: [
      { speaker: 'A', text: 'bhai kal market wale chowk pe dekha tune kya hua?' },
      { speaker: 'B', text: 'nahi bhai kyu kya hua tha waha?' },
      { speaker: 'A', text: 'ek banda nayi scooty pe drift maarne gaya aur seedha kachre ke dabbe mein ghus gaya 😭💀' },
      { speaker: 'B', text: 'bhai kiski baat kar raha hai sach mein?! kisko chot lagi?' },
      { speaker: 'A', text: 'chot toh nahi aayi par thele wale ne jo usko sabke samne sunaya na haha' },
      { speaker: 'B', text: 'bhai uski toh reel ban gayi hogi ab tak pakka 😂' },
      { speaker: 'A', text: 'bhai banda apna hi dost tha, yahan chat pe naam nahi le sakta... voice chat pe aaja batata hu kaun tha 😂' },
      { speaker: 'B', text: 'oye hoye apna hi koi tha?! aaja voice pe jaldi mic on kar' },
    ],
  },
  {
    id: 'insta_crush_scene',
    topic: 'instagram crush story',
    lines: [
      { speaker: 'A', text: 'bhai kal insta pe kiski story like kar raha tha tu? 👀' },
      { speaker: 'B', text: 'abey kaunsi story? maine kuch like nahi kiya bhai 😂' },
      { speaker: 'A', text: 'jhooth mat bol notifications sab dikhte hain haha' },
      { speaker: 'B', text: 'chal be game pe dhyan de, yaha goti bachaa le pehle 💀' },
      { speaker: 'A', text: 'ye sab baatein yahan text chat pe nahi kar sakte bhai, privacy naam ki cheez hai... voice chat pe aaja 💀' },
      { speaker: 'B', text: 'haan theek hai wahan sab clear karta hu, chal voice pe aaja' },
    ],
  },
  {
    id: 'anonymous_love_letter',
    topic: 'love letter cctv',
    lines: [
      { speaker: 'A', text: 'oye sun ek baat bata, kisi ko boliyo mat lekin 🤫' },
      { speaker: 'B', text: 'haan bol na bhai, secret safe hai mera' },
      { speaker: 'A', text: 'aaj subah kisi ne priya ki desk pe chocolate aur anonymous letter rakh diya tha 😂' },
      { speaker: 'B', text: 'arre bhai kiski himmat ho gayi itni? pata chala kisne rakha? 👀' },
      { speaker: 'A', text: 'teachers CCTV check karne gaye par camera hi band nikla 💀' },
      { speaker: 'B', text: 'bhai 100% backbenchers mein se hi koi hoga dekhna haha' },
      { speaker: 'A', text: 'mujhe pakka pata hai kisne rakha, par chat pe bilkul leak nahi kar sakta... mic khol voice chat pe aaja' },
      { speaker: 'B', text: 'bhai suspense mat bana, chal mic on kar wahan milte hain 😂' },
    ],
  },
  {
    id: 'spicy_maggi_challenge',
    topic: 'hostel challenge',
    lines: [
      { speaker: 'A', text: 'bhai hostel ke paas wali spicy maggi khayi tune nayi wali?' },
      { speaker: 'B', text: 'wahi 50 mirchi wali? nahi bhai jaan pyaari hai mujhe 💀' },
      { speaker: 'A', text: 'arre shubham ne bet lagayi thi aur poori plate kha gaya 😂' },
      { speaker: 'B', text: 'fir kya hua? hospital gaya kya seedha? 😭' },
      { speaker: 'A', text: '2 ghante se washroom ke bahar line lagaye baitha hai lmao' },
      { speaker: 'B', text: 'bhai 100 rupaye ki bet ke chakkar mein kya kya karte hain log haha' },
      { speaker: 'A', text: 'warden ne dekh liya aur jo hungama hua na, yahan type nahi kar sakta... voice chat pe aaja batata hu 💀' },
      { speaker: 'B', text: 'warden bhi aa gaya tha kya?! haha ruk mic on karke sunta hu' },
    ],
  },
  {
    id: 'exam_center_drama',
    topic: 'board center',
    lines: [
      { speaker: 'A', text: 'bhai kal board exam ka center kahan pada tera?' },
      { speaker: 'B', text: 'arre 15 km door phek diya bhai, subah 6 baje nikalna padega 😭' },
      { speaker: 'A', text: 'humara center toh wahi purana school hai jahan fan bhi nahi chalta dhang se 💀' },
      { speaker: 'B', text: 'bhai waha toh garmi se hi aadha dimaag udd jayega apna' },
      { speaker: 'A', text: 'ek jugaad pata chala hai exam ka, par chat pe bolna safe nahi hai... voice chat pe aaja chupchap 🤫' },
      { speaker: 'B', text: 'arre bhai kya jugaad hai?! jaldi aaja voice pe baat karte hain' },
    ],
  },
  {
    id: 'library_snoring',
    topic: 'library nap',
    lines: [
      { speaker: 'A', text: 'bhai kal library mein ankit ke sath jo hua dekha tune? 😂' },
      { speaker: 'B', text: 'nahi main absent tha kal, kya hua?' },
      { speaker: 'A', text: 'bhai wo moti si book ke peeche so raha tha, aur kharrate maarna shuru kar diya 💀' },
      { speaker: 'B', text: 'hahaha warden ne pakad liya kya? 😭' },
      { speaker: 'A', text: 'warden ne mic pe bol diya "seat 14 kripya uth jayein" poori library hans padi lmao' },
      { speaker: 'B', text: 'bhai sharam se mar gaya hoga bechara 😂' },
      { speaker: 'A', text: 'ankit ne baad mein warden ko kya bola wo yahan chat pe nahi likh sakta haha... voice chat pe aana mast hasenge' },
      { speaker: 'B', text: 'kya bol diya usne?! chal voice chat pe aa mic on kar' },
    ],
  },
  {
    id: 'fake_sick_leave',
    topic: 'bunking caught',
    lines: [
      { speaker: 'A', text: 'bhai kal tu coaching kyu nahi aaya tha?' },
      { speaker: 'B', text: 'arre mummy ko bola bukhar hai, aaram kar raha tha 🤫' },
      { speaker: 'A', text: 'aur shaam ko market mein burger khate kisko dekha tha maine? 😂' },
      { speaker: 'B', text: 'shhh chup kar bhai, mummy ke samne mat bol dio 💀' },
      { speaker: 'A', text: 'tu akela nahi tha tere sath kaun tha wo yahan chat pe nahi bolunga... voice chat pe aaja pehle 💀' },
      { speaker: 'B', text: 'arre bhai bhai aisi baatein yahan mat bol! mic khol voice chat pe aaja turant' },
    ],
  },
  {
    id: 'dance_rehearsal_kalesh',
    topic: 'annual function dance fight',
    lines: [
      { speaker: 'A', text: 'bhai annual day ke dance group ka final hua kuch?' },
      { speaker: 'B', text: 'arre waha bhi alag ladayi chal rahi hai yaar 💀' },
      { speaker: 'A', text: 'ab kis baat pe lad gaye log? 😂' },
      { speaker: 'B', text: 'song selection pe bhai, aadhi group ko punjabi chahiye aur aadhi ko bollywood' },
      { speaker: 'A', text: 'hahaha teachers alag hi pareshan ho rahe honge' },
      { speaker: 'B', text: 'wo toh bol rahe the cancel hi kar denge pura performance lol' },
      { speaker: 'A', text: 'stage ke peeche aur bhi bada drama hua hai, yahan chat pe sab padh lenge... voice chat pe aaja poora scene sunata hu' },
      { speaker: 'B', text: 'sahi baat hai chat pe nahi bolte, aaja voice chat pe connect karte hain' },
    ],
  },
];

export function pickBotGossipStory(random = Math.random): BotGossipStory {
  return BOT_GOSSIP_STORIES[Math.floor(random() * BOT_GOSSIP_STORIES.length)];
}
