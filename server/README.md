# Shared server (team dedup + highlights)

Ye PHP + MySQL backend teeno employees ko **ek hi picture** deta hai: jise ek ne
message kar diya ya queue kar liya, wo baaki sab ko highlight dikhta hai aur
dobara queue nahi hota. Dedup ka core `creators` table ka `UNIQUE(creator_id)` +
atomic `INSERT IGNORE` (claim) hai.

## 1. Host karein (ek machine pe)

Kisi ek machine pe PHP + MySQL chahiye:
- **Windows**: XAMPP ya Laragon (Apache + MySQL + PHP)
- **Mac**: MAMP, ya `brew install php mysql`

`server/` folder ko web root mein rakhein, e.g.
`C:\xampp\htdocs\tiktok\server\` ya `/Applications/MAMP/htdocs/tiktok/server/`.

MySQL user pehle se: `tiksly` / `Programmer@2026` (jaisa aapne diya). Agar nahi
bana to MySQL mein:
```sql
CREATE USER 'tiksly'@'localhost' IDENTIFIED BY 'Programmer@2026';
GRANT ALL PRIVILEGES ON *.* TO 'tiksly'@'localhost';
FLUSH PRIVILEGES;
```

## 2. Setup chalayein (ek baar)

Browser mein kholein (ya CLI `php setup.php`):
```
http://localhost/tiktok/server/setup.php
```
Ye **sabhi purane tables delete** karta hai aur naya `creators` table banata hai.
"Setup complete ✅" aana chahiye.

> ⚠️ setup.php sirf ek baar chalayein — dobara chalane se saara data mit jayega.

## 3. Employees ka setup

Har employee apne system pe extension load karke popup mein:
- **Shared server URL** = host machine ka URL, e.g.
  `http://192.168.1.50/tiktok/server/api.php`
  (`192.168.1.50` = host machine ka LAN IP — `ipconfig`/`ifconfig` se milega)
- **Your name** = apna naam (ali / sara / bilal)
- **🔌 Test connection** → "✅ Connected" aana chahiye → **Save settings**

Sab employees **same URL** lagayein. Sab ek hi office network (LAN) pe hone
chahiye taake host machine tak pahunch sakein. (Remote employees ke liye host ko
public server / port-forward karna hoga.)

## Kaise kaam karta hai

- **Add to queue** → server pe `claim`. Jo creator kisi aur ne pehle le liya, wo
  "already taken" ho kar skip; sirf naye us employee ko milte hain.
- **Send hone pe** → `mark_sent` → sab ke pages pe green "✓ Messaged".
- **Highlights** → har page `status` se global sent/queued list leta hai.
- **Reset highlights** (popup) → server ka table bhi truncate karta hai (sabke liye).

## Admin panel (login + team dashboard)

`panel/` folder ek web dashboard deta hai:
- **admin** → sab staff ka kaam, per-staff breakdown, filters, aur naya staff add
- **staff** → sirf apna kaam (queued / sent / failed)

Default admin: **username `admin` / password `admin123`** (setup.php seed karta hai —
pehle login ke baad zaroor change karein, ya naya admin bana kar purana hataayein).

Panel URL: `https://yourdomain.com/server/panel/login.php`

**Zaroori**: staff apna **panel username** hi extension ke "Your name" field mein
daale (e.g. panel mein `ali` banaya to extension mein bhi `ali`) — tabhi uska kaam
match ho kar uske dashboard mein aayega.

## cPanel pe deploy karna

1. **File Manager** → `server/` folder ko `public_html/` (ya subfolder) mein upload karein.
2. **MySQL Databases** se ek DB + user banayein. cPanel naam prefix karta hai, e.g.
   DB `cpuser_tiktok`, user `cpuser_tiksly`. User ko DB pe **All Privileges** dein.
3. `server/config.php` edit karein:
   - `DB_HOST` = `localhost`
   - `DB_NAME` / `DB_USER` / `DB_PASS` = cPanel wale
   - `API_TOKEN` = ek lamba random secret (yahi extension mein bhi lagega)
4. Browser mein ek baar chalayein: `https://yourdomain.com/server/setup.php`
   → "Setup complete ✅". **Phir setup.php ko delete kar dein** (warna koi dobara
   chala kar data uda sakta hai).
5. Extension (har employee) popup mein:
   - **Server URL** = `https://yourdomain.com/server/api.php`
   - **Your name** = uska panel username
   - **Server token** = wahi `API_TOKEN`
   - Test connection → Save

cPanel pe Apache khud PHP serve karta hai — `php -S` ki zarurat nahi.

## Security note

- api.php ab **token-protected** hai: bina sahi `API_TOKEN` koi write nahi kar sakta.
- Public internet pe hamesha **HTTPS** use karein (cPanel pe free AutoSSL milta hai).
- setup.php deploy ke baad **delete** kar dein.
- Panel ke default admin password ko turant change karein.
