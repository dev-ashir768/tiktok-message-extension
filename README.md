# TikTok Shop Bulk Creator Messenger

TikTok Shop Partner Center pe creators select karke unhe bulk messages bhejne wali Chrome extension.

## Install (1 minute)

1. Chrome mein `chrome://extensions` kholein
2. Right-top pe **Developer mode** ON karein
3. **Load unpacked** pe click karein aur ye folder select karein:
   `/Users/ashirarif/automations/tiktok-message-extension`

## Istemaal ka tareeqa

1. **Partner Center → Find creators** page kholein (list/table view mein).
2. Har row ke aage ek **checkbox** nazar aayega, aur bottom-right pe ek **"📨 Bulk Messenger"** panel.
3. Creators select karein (ya **Select page** se poora page) → **➕ Add to queue**.
   - Pagination se agla page kholein aur wahan se bhi add karte jayein — queue mein duplicate creators khud filter ho jate hain.
4. Extension ke **popup icon** pe click karke:
   - **Message template** likhein — tokens available: `{handle}`, `{nickname}`, `{first_name}`
     (e.g. `Hi {first_name}!` → "Hi Josh!")
   - Delay aur daily cap set karein → **Save settings**
5. **▶ Start** dabayein (popup ya page panel, dono se ho sakta hai).

Extension har creator ke liye background tab kholti hai, message type karke Send karti hai, tab band karti hai, random delay ka wait karti hai, aur agle creator pe chali jati hai. Aap browser use karte reh sakte hain — bas Chrome khula rahna chahiye.

## Kaise chalti hai (worker pool)

- Ek saath **2-3 tabs** background mein load hote hain (popup mein "Parallel tabs" se set karein). TikTok ka chat panel har fresh tab pe ~25 sec leta hai — pool se ye dead time overlap ho jata hai.
- Lekin asli **message send global throttle se 30-60 sec mein sirf ek** jata hai. Yani tabs parallel load hote hain, mag_r bhejna insani raftaar pe rehta hai — is liye account safe.
- 1 tab (sequential) ke muqable 3-tab pool wall-clock time ~1/3 kar deta hai.

## Timing ka hisaab

- Default: 3 parallel tabs, send delay 30–60 sec random
- 500 messages ≈ **3–4 ghante** (3-tab pool ke sath)
- Delay 30 sec se kam na karein — chahe kitne bhi tabs hon, ye send-rate hi account ki safety hai
- Daily cap (default 500) khud campaign rok deti hai; counter roz reset hota hai
- **Ehtiyaat**: parallel tabs 5 se zyada na karein. Zyada tabs = burst sending = ban risk. Pehle din 2 tabs + 100-150 cap se shuru karein.

## Team mode (multiple employees, ek account)

Agar 3 employees same TikTok account pe alag-alag systems se kaam karein, to
`server/` ka PHP + MySQL backend lagayein. Isse:
- Ek shared database mein sab sent/queued creators store hote hain
- Har employee "Add to queue" kare to server pehle **claim** karta hai — koi
  creator do baar kisi ko nahi milta (no duplicate messages)
- Sent creators **sab ke pages pe** green "✓ Messaged" highlight

Setup ka poora tareeqa: [server/README.md](server/README.md). Chhota khulasa —
ek machine pe host karein → `setup.php` ek baar chalayein (sab tables reset) →
har employee popup mein **Server URL** + **apna naam** daal kar Test/Save kare.

## Status aur log

- Popup mein live stats: pending / sent / failed / aaj ka count
- **Retry failed** — jo creators fail hue (e.g. 5-message limit) unhe dobara try karein
- Extension icon ke badge pe aaj ke sent messages ka number

## Zaruri baatein / Warnings

- **TikTok account risk**: Bulk automation TikTok ke terms ke khilaf ja sakti hai. Agar TikTok ko unusual activity lage to messaging restrict ya account suspend ho sakta hai. Delay kam na karein, aur pehle din 500 ki bajaye 100–150 se start karke dheere dheere barhana behtar hai.
- **5-message limit**: Jin creators ne kabhi reply nahi kiya unhe TikTok sirf 5 messages tak bhejne deta hai — aisi chats fail ho kar log mein aa jayengi.
- **Message quality**: Personalized template (`{first_name}` use karein) spam reports kam karta hai aur reply rate barhata hai.
- Campaign ke doran TikTok Partner Center mein **logged in** rehna zaroori hai.

## Agar TikTok apna UI badal de

Selectors in files mein hain:
- `finder.js` — creator rows (`Invite` button se rows dhoondhta hai, React data se `creator_oecuid`/`handle` nikalta hai)
- `chat.js` — `textarea[placeholder="Send a message"]` aur **Send** button

UI change hone par ye selectors update karne honge.
