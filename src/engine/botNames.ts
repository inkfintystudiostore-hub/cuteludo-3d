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

export type BotEmoteMood = 'capture' | 'captured' | 'six' | 'home' | 'user_lucky' | 'user_home';

const MOOD_EMOTES: Record<BotEmoteMood, readonly RoomEmoteId[]> = {
  capture: ['dogdance', 'huskydance', 'minionkiss', 'laugh'],
  captured: ['angry', 'grumpy', 'sadhamster', 'dogshock'],
  six: ['wave', 'dogbeach', 'dogbleh', 'doghands'],
  home: ['huskydance', 'dogdance', 'chihuahuaside', 'minionkiss'],
  user_lucky: ['dogsuspect', 'dogstare', 'grumpy', 'dogshock'],
  user_home: ['dogshock', 'sadhamster', 'angry', 'dogstare'],
};

export function pickBotEmote(mood: BotEmoteMood, random = Math.random): RoomEmoteId {
  // 45% chance to pick any random GIF from all 16 for natural variety
  if (random() < 0.45) {
    return ROOM_EMOTE_IDS[Math.floor(random() * ROOM_EMOTE_IDS.length)];
  }
  const list = MOOD_EMOTES[mood];
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
