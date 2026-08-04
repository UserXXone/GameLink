import React, { useEffect, useRef, useState } from 'react';
import {
  Body1Strong, Button, Caption1, Card, Dropdown, Field, Input, Option,
  PresenceBadge, Switch, Text, Tooltip, makeStyles, tokens,
} from '@fluentui/react-components';
import {
  ArrowSyncRegular, DeleteRegular, SaveRegular,
} from '@fluentui/react-icons';
import * as ctrl from './controller';

const useStyles = makeStyles({
  root: { height: '100vh', display: 'flex', flexDirection: 'column' },
  titlebar: {
    flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px',
    padding: '12px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  statusText: {
    marginLeft: 'auto', color: tokens.colorNeutralForeground3,
    maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  content: {
    flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px',
    display: 'flex', flexDirection: 'column', gap: '12px',
  },
  // Sütun flex kabında kartlar doğal boylarını korusun; aksi halde içerik
  // pencereden uzun olduğunda hepsi büzülüp içeriklerini kırpıyor.
  card: { flexShrink: 0 },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '26px', fontWeight: tokens.fontWeightSemibold,
    letterSpacing: '2px', textAlign: 'center', padding: '14px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorBrandForeground1,
    userSelect: 'all',
  },
  row: { display: 'flex', gap: '8px', alignItems: 'flex-end' },
  grow: { flex: 1, minWidth: 0 },
  stack: { display: 'flex', flexDirection: 'column', gap: '8px' },
  hint: { color: tokens.colorNeutralForeground3, lineHeight: 1.5 },
  ok: { color: tokens.colorPaletteGreenForeground1, minHeight: '16px' },
  warn: { color: tokens.colorPaletteDarkOrangeForeground1, minHeight: '16px' },
  device: {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  deviceLast: { borderBottomWidth: 0 },
  deviceName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  log: {
    fontFamily: tokens.fontFamilyMonospace, fontSize: '11px', margin: 0,
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    padding: '10px 12px', height: '110px', overflowY: 'auto',
    whiteSpace: 'pre-wrap', lineHeight: 1.5,
  },
});

const PRESENCE = { connected: 'available', waiting: 'away', idle: 'offline' };

const ICE_LABELS = {
  'auto': 'Otomatik (önce doğrudan, olmazsa TURN)',
  'stun-only': 'Sadece STUN (yalnızca doğrudan bağlantı)',
  'turn-only': 'Sadece TURN (her şey röle üzerinden)',
};

function Section({ title, children, styles }) {
  return (
    <Card className={styles.card}>
      <Body1Strong>{title}</Body1Strong>
      <div className={styles.stack}>{children}</div>
    </Card>
  );
}

// Kaydedildi mesajını kısa süre gösterip kendiliğinden temizleyen alan
function useFlash() {
  const [msg, setMsg] = useState('');
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  return [msg, (text, ms = 2500) => {
    setMsg(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(''), ms);
  }];
}

export default function App() {
  const styles = useStyles();
  const [snap, setSnap] = useState(ctrl.state);
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [turn, setTurn] = useState({ url: '', username: '', credential: '' });
  const [pwFlash, flashPw] = useFlash();
  const [urlFlash, flashUrl] = useFlash();
  const [turnFlash, flashTurn] = useFlash();
  const logRef = useRef();

  useEffect(() => ctrl.subscribe(setSnap), []);
  useEffect(() => { ctrl.init(); }, []);

  const cfg = snap.config;

  // Sunucu adresi ve TURN alanları config yüklendiğinde bir kez doldurulur;
  // sonrasında kullanıcının yazdığı değer korunur.
  useEffect(() => {
    if (!cfg) return;
    setUrl((v) => (v === '' ? cfg.signalingUrl || '' : v));
    setTurn((v) => (v.url === '' && v.username === '' && v.credential === '' ? { ...cfg.turn } : v));
  }, [cfg && cfg.signalingUrl, cfg && cfg.turn]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [snap.logs]);

  if (!cfg) {
    return (
      <div className={styles.root}>
        <div className={styles.titlebar}>
          <PresenceBadge status="offline" />
          <Body1Strong>GameLink Host</Body1Strong>
        </div>
      </div>
    );
  }

  const turnOnlyWithoutTurn = cfg.iceMode === 'turn-only' && !(cfg.turn && cfg.turn.url);
  const currentSource = snap.sources.find((s) => s.id === snap.currentSourceId);

  return (
    <div className={styles.root}>
      <div className={styles.titlebar}>
        <PresenceBadge status={PRESENCE[snap.status.kind] || 'offline'} />
        <Body1Strong>GameLink Host</Body1Strong>
        <Caption1 className={styles.statusText}>{snap.status.text}</Caption1>
      </div>

      <div className={styles.content}>
        <Section title="Bağlantı Kodu" styles={styles}>
          <div className={styles.code}>{cfg.hostCode}</div>
          <div>
            <Button icon={<ArrowSyncRegular />} onClick={() => ctrl.regenerateCode()}>
              Yeniden Üret
            </Button>
          </div>
        </Section>

        <Section title="Parola" styles={styles}>
          <div className={styles.row}>
            <Input className={styles.grow} type="password" value={password}
              placeholder={cfg.hasPassword ? '•••••••• (ayarlı)' : 'Henüz parola ayarlanmadı'}
              onChange={(_e, d) => setPassword(d.value)} />
            <Button appearance="primary" icon={<SaveRegular />} disabled={!password}
              onClick={async () => {
                await ctrl.savePassword(password);
                setPassword('');
                flashPw('Kaydedildi.');
              }}>Kaydet</Button>
          </div>
          <Caption1 className={styles.ok}>{pwFlash}</Caption1>
        </Section>

        <Section title="Sunucu Adresi" styles={styles}>
          <div className={styles.row}>
            <Input className={styles.grow} value={url} placeholder="wss://sizin-domaininiz.com"
              onChange={(_e, d) => setUrl(d.value)} />
            <Button appearance="primary" icon={<SaveRegular />} disabled={!url.trim()}
              onClick={async () => {
                await ctrl.saveSignalingUrl(url.trim());
                flashUrl('Kaydedildi, yeniden bağlanılıyor...');
              }}>Kaydet</Button>
          </div>
          <Caption1 className={styles.ok}>{urlFlash}</Caption1>
        </Section>

        <Section title="Paylaşılan Ekran" styles={styles}>
          <Dropdown value={currentSource ? currentSource.name : ''}
            selectedOptions={snap.currentSourceId ? [snap.currentSourceId] : []}
            onOptionSelect={(_e, d) => ctrl.setCaptureSource(d.optionValue)}>
            {snap.sources.map((s) => (
              <Option key={s.id} value={s.id} text={s.name}>
                {s.name}{s.primary ? ' (birincil)' : ''}
              </Option>
            ))}
          </Dropdown>
          <Caption1 className={styles.hint}>
            Bağlıyken de değiştirebilirsiniz; görüntü kesilmeden geçer.
            Client de bu listeden seçim yapabilir.
          </Caption1>
        </Section>

        <Section title="Pano" styles={styles}>
          <Switch checked={!!cfg.clipboardSync}
            onChange={(_e, d) => ctrl.setClipboardSync(d.checked)}
            label="Panoyu client ile karşılıklı eşitle (metin)" />
        </Section>

        <Section title="Pencere" styles={styles}>
          <Switch checked={cfg.minimizeToTray !== false}
            onChange={(_e, d) => ctrl.setMinimizeToTray(d.checked)}
            label="Küçültünce sistem tepsisine in" />
          <Caption1 className={styles.hint}>
            Kapatma düğmesi de programı sonlandırmaz, tepsiye indirir — böylece uzaktan
            bağlantı hep açık kalır. Tamamen çıkmak için tepsi simgesine sağ tıklayıp
            Çıkış deyin.
          </Caption1>
        </Section>

        <Section title="Bağlantı Modu" styles={styles}>
          <Dropdown value={ICE_LABELS[cfg.iceMode || 'auto']}
            selectedOptions={[cfg.iceMode || 'auto']}
            onOptionSelect={(_e, d) => ctrl.setIceMode(d.optionValue)}>
            {Object.entries(ICE_LABELS).map(([k, v]) => (
              <Option key={k} value={k} text={v}>{v}</Option>
            ))}
          </Dropdown>
          {turnOnlyWithoutTurn && (
            <Caption1 className={styles.warn}>
              Uyarı: TURN sunucusu tanımlı değil, bu mod uygulanamaz.
            </Caption1>
          )}
          <Caption1 className={styles.hint}>
            <b>Otomatik:</b> en iyi seçenek — doğrudan bağlanmayı dener, başaramazsa TURN'e düşer.<br />
            <b>Sadece STUN:</b> TURN hiç kullanılmaz. En düşük gecikme, ama CGNAT'li ağlarda bağlanamayabilir.<br />
            <b>Sadece TURN:</b> tüm trafik röle üzerinden gider. Daha tutarlı ama sunucunuzun bant genişliğini kullanır.
          </Caption1>
        </Section>

        <Section title="TURN Sunucusu (isteğe bağlı)" styles={styles}>
          <Input value={turn.url} placeholder="turn:sizin-domaininiz.com:3478"
            onChange={(_e, d) => setTurn({ ...turn, url: d.value })} />
          <div className={styles.row}>
            <Input className={styles.grow} value={turn.username} placeholder="kullanıcı"
              onChange={(_e, d) => setTurn({ ...turn, username: d.value })} />
            <Input className={styles.grow} type="password" value={turn.credential} placeholder="parola"
              onChange={(_e, d) => setTurn({ ...turn, credential: d.value })} />
          </div>
          <div>
            <Button appearance="primary" icon={<SaveRegular />}
              onClick={async () => {
                await ctrl.saveTurn({ ...turn, url: turn.url.trim() });
                flashTurn(turn.url.trim()
                  ? 'Kaydedildi. Bir sonraki bağlantıda geçerli olur.'
                  : 'TURN kapatıldı (sadece STUN kullanılacak).', 3500);
              }}>Kaydet</Button>
          </div>
          <Caption1 className={styles.ok}>{turnFlash}</Caption1>
          <Caption1 className={styles.hint}>
            Mobil veri (CGNAT) gibi STUN'un yetmediği durumlarda gerekir. Buraya yazdığınız
            bilgi bağlantı sırasında client'a otomatik iletilir — client tarafında ayrıca
            ayar yapmanız gerekmez.
          </Caption1>
        </Section>

        <Section title="Güvenilir Cihazlar" styles={styles}>
          {cfg.trustedDevices.length === 0 ? (
            <Caption1 className={styles.hint}>
              Henüz güvenilir cihaz yok. İlk bağlantıda parola ile giren cihaz otomatik eklenir.
            </Caption1>
          ) : cfg.trustedDevices.map((d, i) => (
            <div key={d.hwid}
              className={`${styles.device} ${i === cfg.trustedDevices.length - 1 ? styles.deviceLast : ''}`}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text className={styles.deviceName} block>{d.name || 'Adsız cihaz'}</Text>
                <Caption1 className={styles.hint}>
                  Son görülme: {d.lastSeen ? new Date(d.lastSeen).toLocaleString('tr-TR') : '-'}
                </Caption1>
              </div>
              <Tooltip content="Bu cihazı kaldır" relationship="label">
                <Button appearance="subtle" icon={<DeleteRegular />}
                  onClick={() => ctrl.removeTrustedDevice(d.hwid, d.name)} />
              </Tooltip>
            </div>
          ))}
        </Section>

        <Section title="Günlük" styles={styles}>
          <pre className={styles.log} ref={logRef}>{snap.logs.join('\n')}</pre>
        </Section>
      </div>
    </div>
  );
}
