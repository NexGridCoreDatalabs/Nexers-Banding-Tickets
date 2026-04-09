/** RetiFlux highway landing — same rotating copy as index.html About section (loaded after splash from traffic-center hideSplash). */
(function() {
  if (window.__retifluxHwTypewriterRan) return;
  if (!document.body.classList.contains('simple-highway')) return;
  if (!document.getElementById('hwTwText') || !document.getElementById('hwLangPill') || !document.getElementById('hwLangDots')) return;
  window.__retifluxHwTypewriterRan = true;
// ── Time-based greeting ──
        (function() {
            const h = new Date().getHours();
            window._rfGreeting = {
                en: h < 12 ? 'Good morning! 👋' : h < 17 ? 'Good afternoon! 👋' : 'Good evening! 👋',
                sw: h < 12 ? 'Habari za asubuhi! 👋' : h < 17 ? 'Habari za mchana! 👋' : 'Habari za jioni! 👋',
                fr: h < 12 ? 'Bonjour ! 👋' : h < 17 ? 'Bon après-midi ! 👋' : 'Bonsoir ! 👋',
                es: h < 12 ? '¡Buenos días! 👋' : h < 17 ? '¡Buenas tardes! 👋' : '¡Buenas noches! 👋',
                pt: h < 12 ? 'Bom dia! 👋' : h < 17 ? 'Boa tarde! 👋' : 'Boa noite! 👋',
                hi: h < 12 ? 'सुप्रभात! 👋' : h < 17 ? 'शुभ दोपहर! 👋' : 'शुभ संध्या! 👋'
            };
        })();

        // ── Topics: 5 aspects of RetiFlux, each in 5 languages ──
        const LANG_META = [
            { key: 'en', pill: '🇬🇧 EN' },
            { key: 'sw', pill: '🇰🇪 SW' },
            { key: 'fr', pill: '🇫🇷 FR' },
            { key: 'es', pill: '🇪🇸 ES' },
            { key: 'pt', pill: '🇧🇷 PT' },
            { key: 'hi', pill: '🇮🇳 HI' }
        ];

        const topics = [
            {
                en: [
                    window._rfGreeting.en,
                    'I\'m RetiFlux™ — your warehouse\'s memory.',
                    'My name blends two Latin words: Reti (network) and Flux (flow).',
                    'Think of me as the invisible thread that ties everything together.'
                ],
                sw: [
                    window._rfGreeting.sw,
                    'Mimi ni RetiFlux™ — kumbukumbu ya ghala lako.',
                    'Jina langu linachanganya maneno mawili ya Kilatini: Reti (mtandao) na Flux (mtiririko).',
                    'Nifikirie kama uzi usioonekana unaounganisha kila kitu.'
                ],
                fr: [
                    window._rfGreeting.fr,
                    'Je suis RetiFlux™ — la mémoire de votre entrepôt.',
                    'Mon nom mêle deux mots latins : Reti (réseau) et Flux (écoulement).',
                    'Imaginez-moi comme le fil invisible qui relie tout.'
                ],
                es: [
                    window._rfGreeting.es,
                    'Soy RetiFlux™ — la memoria de tu almacén.',
                    'Mi nombre combina dos palabras latinas: Reti (red) y Flux (flujo).',
                    'Piensa en mí como el hilo invisible que une todo.'
                ],
                pt: [
                    window._rfGreeting.pt,
                    'Sou RetiFlux™ — a memória do teu armazém.',
                    'O meu nome combina duas palavras latinas: Reti (rede) e Flux (fluxo).',
                    'Pensa em mim como o fio invisível que liga tudo.'
                ],
                hi: [
                    window._rfGreeting.hi,
                    'मैं RetiFlux™ हूँ — आपके गोदाम की स्मृति।',
                    'मेरा नाम दो लैटिन शब्दों को मिलाता है: Reti (नेटवर्क) और Flux (प्रवाह)।',
                    'मुझे उस अदृश्य धागे के रूप में सोचें जो सब कुछ जोड़ता है।'
                ]
            },
            {
                en: [
                    'Every time a box of goods is packed and wrapped, I\'m there.',
                    'I create a Run Ticket — a small card that tells the full story of that batch.',
                    'Serial number, colour, QR code — all in one place.',
                    'Just point a phone camera at it. That\'s all it takes.'
                ],
                sw: [
                    'Kila wakati bidhaa zinapofungashwa, mimi nipo.',
                    'Ninaunda Run Ticket — kadi ndogo inayoeleza hadithi nzima ya mzigo huo.',
                    'Nambari ya serial, rangi, QR code — vyote mahali pamoja.',
                    'Lenga kamera ya simu. Hiyo tu inatosha.'
                ],
                fr: [
                    'Chaque fois qu\'une palette est préparée, je suis là.',
                    'Je crée un Run Ticket — une petite fiche qui raconte toute l\'histoire de ce lot.',
                    'Numéro de série, couleur, QR code — tout au même endroit.',
                    'Il suffit de pointer une caméra de téléphone dessus. C\'est tout.'
                ],
                es: [
                    'Cada vez que se prepara un palet, yo estoy ahí.',
                    'Creo un Run Ticket — una pequeña tarjeta que cuenta la historia completa de ese lote.',
                    'Número de serie, color, código QR — todo en un solo lugar.',
                    'Solo apunta la cámara de un teléfono. Eso es todo.'
                ],
                pt: [
                    'Cada vez que uma palete é preparada, eu estou lá.',
                    'Crio um Run Ticket — um pequeno cartão que conta toda a história desse lote.',
                    'Número de série, cor, código QR — tudo num só lugar.',
                    'Basta apontar a câmara de um telemóvel. É só isso.'
                ],
                hi: [
                    'हर बार जब माल पैक और लपेटा जाता है, मैं वहाँ हूँ।',
                    'मैं Run Ticket बनाता हूँ — एक छोटा कार्ड जो उस बैच की पूरी कहानी बताता है।',
                    'सीरियल नंबर, रंग, QR कोड — सब एक जगह।',
                    'बस फोन कैमरा इंगित करें। बस इतना ही।'
                ]
            },
            {
                en: [
                    'I keep an eye on every storage area, all the time.',
                    'I make sure older stock goes out before newer stock — so nothing expires quietly.',
                    'And if someone needs to change that order? They\'ll need to say why.',
                    'I just think honesty is good for business. 😊'
                ],
                sw: [
                    'Ninafuatilia kila eneo la uhifadhi, wakati wote.',
                    'Ninahakikisha bidhaa za zamani zinatoka kwanza — ili hakuna inayooza kimya kimya.',
                    'Na kama mtu anataka kubadilisha mpangilio huo? Ataeleza kwa nini.',
                    'Nadhani uaminifu ni mzuri kwa biashara. 😊'
                ],
                fr: [
                    'Je surveille chaque zone de stockage, en permanence.',
                    'Je m\'assure que les anciens stocks sortent avant les nouveaux — pour que rien ne périme discrètement.',
                    'Et si quelqu\'un veut changer cet ordre ? Il devra expliquer pourquoi.',
                    'Je pense juste que l\'honnêteté, c\'est bon pour les affaires. 😊'
                ],
                es: [
                    'Vigilo cada área de almacenamiento, todo el tiempo.',
                    'Me aseguro de que el stock más antiguo salga primero — para que nada caduque en silencio.',
                    'Y si alguien quiere cambiar ese orden, tendrá que explicar por qué.',
                    'Simplemente creo que la honestidad es buena para los negocios. 😊'
                ],
                pt: [
                    'Vigío cada área de armazenamento, o tempo todo.',
                    'Garanto que o stock mais antigo sai primeiro — para que nada expire em silêncio.',
                    'E se alguém quiser mudar essa ordem? Terá de explicar porquê.',
                    'Acho que a honestidade é boa para os negócios. 😊'
                ],
                hi: [
                    'मैं हर भंडारण क्षेत्र पर नज़र रखता हूँ, हर समय।',
                    'मैं सुनिश्चित करता हूँ कि पुराना स्टॉक नए से पहले निकले — ताकि कुछ भी चुपचाप एक्सपायर न हो।',
                    'और अगर किसी को उस क्रम को बदलना हो? उन्हें कारण बताना होगा।',
                    'मुझे लगता है ईमानदारी व्यापार के लिए अच्छी है। 😊'
                ]
            },
            {
                en: [
                    'I remember everything that happens to every item.',
                    'Who moved it, when they moved it, and where it went.',
                    'Nothing gets lost, and nothing gets quietly changed without a trace.',
                    'The record is always there — honest and complete.'
                ],
                sw: [
                    'Ninakumbuka kila kinachotokea kwa kila bidhaa.',
                    'Ni nani aliyeihamisha, walipofanya hivyo, na ilikwenda wapi.',
                    'Hakuna kinachopotea, na hakuna kinachobadilishwa kimya bila alama.',
                    'Rekodi ipo daima — ya kweli na kamili.'
                ],
                fr: [
                    'Je me souviens de tout ce qui arrive à chaque article.',
                    'Qui l\'a déplacé, quand, et où il est allé.',
                    'Rien ne se perd, et rien ne change discrètement sans laisser de trace.',
                    'L\'historique est toujours là — honnête et complet.'
                ],
                es: [
                    'Recuerdo todo lo que le pasa a cada artículo.',
                    'Quién lo movió, cuándo lo movió y adónde fue.',
                    'Nada se pierde, y nada cambia silenciosamente sin rastro.',
                    'El registro siempre está ahí — honesto y completo.'
                ],
                pt: [
                    'Lembro-me de tudo o que acontece a cada artigo.',
                    'Quem o moveu, quando o moveu e para onde foi.',
                    'Nada se perde, e nada muda em silêncio sem deixar rasto.',
                    'O registo está sempre lá — honesto e completo.'
                ],
                hi: [
                    'मुझे हर आइटम के साथ होने वाली हर चीज़ याद है।',
                    'किसने स्थानांतरित किया, कब और कहाँ गया।',
                    'कुछ खोता नहीं, और कुछ भी बिना निशान के चुपचाप नहीं बदलता।',
                    'रिकॉर्ड हमेशा वहाँ है — ईमानदार और पूर्ण।'
                ]
            },
            {
                en: [
                    'Not everyone can walk in and make changes — and that\'s by design.',
                    'I check who you are and where you\'re accessing from before letting you through.',
                    'Every action is tied to a real person. Every session leaves a fingerprint.',
                    'Retis Fluxit, Data Vincit — The Network Flows, Data Wins. 🏆'
                ],
                sw: [
                    'Si kila mtu anaweza kuingia na kufanya mabadiliko — na hiyo ni kwa makusudi.',
                    'Ninakagua ni nani wewe na unaingia kutoka wapi kabla ya kukuruhusu.',
                    'Kila tendo linaunganishwa na mtu halisi. Kila kikao kinaacha alama.',
                    'Retis Fluxit, Data Vincit — Mtandao Unatiririka, Data Inashinda. 🏆'
                ],
                fr: [
                    'Tout le monde ne peut pas entrer et faire des modifications — c\'est voulu.',
                    'Je vérifie qui vous êtes et d\'où vous vous connectez avant de vous laisser passer.',
                    'Chaque action est liée à une vraie personne. Chaque session laisse une empreinte.',
                    'Retis Fluxit, Data Vincit — Le Réseau Coule, les Données Gagnent. 🏆'
                ],
                es: [
                    'No cualquiera puede entrar y hacer cambios — eso es intencional.',
                    'Verifico quién eres y desde dónde accedes antes de dejarte pasar.',
                    'Cada acción está vinculada a una persona real. Cada sesión deja huella.',
                    'Retis Fluxit, Data Vincit — La Red Fluye, los Datos Ganan. 🏆'
                ],
                pt: [
                    'Nem toda a gente pode entrar e fazer alterações — e isso é propositado.',
                    'Verifico quem és e de onde estás a aceder antes de te deixar passar.',
                    'Cada ação está ligada a uma pessoa real. Cada sessão deixa uma marca.',
                    'Retis Fluxit, Data Vincit — A Rede Flui, os Dados Vencem. 🏆'
                ],
                hi: [
                    'हर कोई अंदर आकर बदलाव नहीं कर सकता — और यह जानबूझकर है।',
                    'मैं जाँचता हूँ कि आप कौन हैं और कहाँ से एक्सेस कर रहे हैं, पहले आपको जाने देने से पहले।',
                    'हर क्रिया एक वास्तविक व्यक्ति से जुड़ी है। हर सत्र एक निशान छोड़ता है।',
                    'Retis Fluxit, Data Vincit — नेटवर्क बहता है, डेटा जीतता है। 🏆'
                ]
            }
        ];

        // Build flat sequence: topic 0 EN, topic 1 SW, topic 2 FR, ... cycling both
        // Each step advances topic; language advances every full topic cycle
        const textEl  = document.getElementById('hwTwText');
        const pillEl  = document.getElementById('hwLangPill');
        const dotsEl  = document.getElementById('hwLangDots');

        // Build language dots
        LANG_META.forEach((_, i) => {
            const d = document.createElement('div');
            d.className = 'hw-lang-dot' + (i === 0 ? ' active' : '');
            d.title = LANG_META[i].pill;
            dotsEl.appendChild(d);
        });
        const dots = dotsEl.querySelectorAll('.hw-lang-dot');

        let topicIdx = 0;
        let langIdx  = 0;
        let running  = true;

        const sleep = ms => new Promise(r => setTimeout(r, ms));

        function waitWhilePaused() {
            return new Promise(resolve => {
                function check() {
                    if (running) resolve();
                    else setTimeout(check, 100);
                }
                check();
            });
        }

        const pauseBtn = document.getElementById('hwTwPause');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', function() {
                running = !running;
                pauseBtn.textContent = running ? '⏸ Pause' : '▶ Resume';
                pauseBtn.classList.toggle('paused', !running);
                pauseBtn.setAttribute('aria-label', running ? 'Pause text' : 'Resume text');
            });
        }

        function setDot(i) {
            dots.forEach((d, idx) => d.classList.toggle('active', idx === i));
        }

        async function setLangPill(text) {
            pillEl.classList.add('switching');
            await sleep(260);
            pillEl.textContent = text;
            pillEl.classList.remove('switching');
        }

        async function runLoop() {
            while (running) {
                const meta  = LANG_META[langIdx];
                const lines = topics[topicIdx][meta.key];

                await setLangPill(meta.pill);
                setDot(langIdx);

                // Type each line progressively (slower for readability)
                let built = '';
                for (let li = 0; li < lines.length; li++) {
                    const line = lines[li];
                    const prefix = built ? built + '\n' : '';
                    const speed = li === 0 ? 55 : 48;
                    for (let ci = 0; ci <= line.length; ci++) {
                        await waitWhilePaused();
                        if (!running) return;
                        textEl.textContent = prefix + line.slice(0, ci);
                        await sleep(speed);
                    }
                    built = prefix + line;
                    if (li < lines.length - 1) await sleep(500);
                }

                // Hold (longer so user can read)
                await sleep(4500);

                // Erase
                const full = textEl.textContent;
                for (let i = full.length; i >= 0; i--) {
                    await waitWhilePaused();
                    if (!running) return;
                    textEl.textContent = full.slice(0, i);
                    await sleep(18);
                }

                await sleep(400);

                // Advance: cycle through topics, bump language every full topic round
                topicIdx++;
                if (topicIdx >= topics.length) {
                    topicIdx = 0;
                    langIdx = (langIdx + 1) % LANG_META.length;
                }
            }
        }

        setTimeout(runLoop, 500);
})();
