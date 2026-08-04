import React, { useEffect, useRef, useState } from 'react';
import {
  Body1Strong, Button, Caption1, Card, Dropdown, Field, Input, Option,
  Radio, RadioGroup, Subtitle2, Switch, Text, Tooltip, makeStyles, tokens,
} from '@fluentui/react-components';
import {
  DataUsageRegular, DismissRegular, FullScreenMaximizeRegular,
  PlugConnectedRegular, PlugDisconnectedRegular, SettingsRegular,
} from '@fluentui/react-icons';
import * as ctrl from './controller';

const useStyles = makeStyles({
  // ---------- Bağlantı ekranı ----------
  connectView: { display: 'flex', height: '100vh' },
  sidebar: {
    width: '280px', flexShrink: 0, display: 'flex', flexDirection: 'column',
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sidebarHeader: {
    padding: '16px 18px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  connList: { flex: 1, overflowY: 'auto', padding: '8px' },
  connItem: {
    display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
    padding: '9px 8px 9px 12px', marginBottom: '4px',
    borderRadius: tokens.borderRadiusMedium,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  connLabel: {
    flex: 1, minWidth: 0, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  mainForm: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  card: { width: '340px', padding: '24px' },
  stack: { display: 'flex', flexDirection: 'column', gap: '12px' },
  connectBtn: { marginTop: '4px' },
  status: { textAlign: 'center', minHeight: '16px', color: tokens.colorNeutralForeground3 },
  statusErr: { color: tokens.colorPaletteRedForeground1 },
  hint: { color: tokens.colorNeutralForeground3, lineHeight: 1.5 },

  // ---------- Video sahnesi ----------
  stage: { height: '100vh', position: 'relative', backgroundColor: '#000' },
  video: { width: '100%', height: '100%', objectFit: 'contain', cursor: 'none', display: 'block' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, padding: '10px 14px',
    display: 'flex', alignItems: 'center', gap: '8px',
    background: 'linear-gradient(rgba(0,0,0,.75), transparent)',
    transition: 'opacity .3s',
  },
  topBarHidden: { opacity: 0, pointerEvents: 'none' },
  spacer: { flex: 1, minWidth: '8px' },
  pill: {
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: '5px 12px', whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
  },
  overlayInfo: {
    color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap', flexShrink: 0,
    fontFamily: tokens.fontFamilyMonospace,
  },
  // Panel ve istatistik kutusunda bilerek bulanıklık yok: oyun görüntüsünün
  // üstünde sürekli backdrop-filter hesaplamak GPU maliyeti doğurur.
  panel: {
    position: 'absolute', top: '54px', right: '14px', width: '300px',
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow16, padding: '16px',
    maxHeight: 'calc(100% - 76px)', overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: '8px',
  },
  statsBox: {
    position: 'absolute', top: '54px', left: '14px', minWidth: '210px',
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow16, padding: '12px 14px',
  },
  statRow: { display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '3px 0' },
  statVal: { fontFamily: tokens.fontFamilyMonospace },
  sectionGap: { marginTop: '8px' },
});

const MODES = [
  { key: 'game', label: 'Oyun — en düşük gecikme' },
  { key: 'normal', label: 'Normal — net görüntü' },
  { key: 'stream', label: 'Streaming — akıcılık' },
];
const QUALITIES = [
  { key: 'data-saver', label: 'Veri Tasarrufu' },
  { key: 'balanced', label: 'Dengeli' },
  { key: 'high', label: 'Yüksek' },
  { key: 'custom', label: 'Özel' },
];

export default function App() {
  const styles = useStyles();
  const [snap, setSnap] = useState(ctrl.state);
  const [form, setForm] = useState({ url: '', code: '', password: '' });
  const videoRef = useRef();
  const passwordRef = useRef();

  useEffect(() => ctrl.subscribe(setSnap), []);
  useEffect(() => { ctrl.init(videoRef.current); }, []);

  // Host parola isterse kullanıcıyı doğrudan parola alanına yönlendir
  useEffect(() => {
    if (snap.needsPassword && passwordRef.current) {
      passwordRef.current.focus();
      passwordRef.current.select();
    }
  }, [snap.needsPassword, snap.connectStatus]);

  const { prefs } = snap;
  const hotkeyLabel = (ctrl.RELEASE_HOTKEYS[prefs.releaseHotkey] || {}).label || '';
  const currentMonitor = snap.monitors.list.find((m) => m.id === snap.monitors.current);

  const doConnect = () => ctrl.connect({
    url: form.url.trim(), code: form.code.trim(), password: form.password,
  });
  const onEnter = (e) => { if (e.key === 'Enter') doConnect(); };

  return (
    <>
      {/* Bağlantı ekranı */}
      <div className={styles.connectView} style={{ display: snap.view === 'connect' ? 'flex' : 'none' }}>
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}><Subtitle2>GameLink</Subtitle2></div>
          <div className={styles.connList}>
            {snap.savedConnections.length === 0 ? (
              <Caption1 className={styles.hint} style={{ display: 'block', padding: '12px' }}>
                Henüz kayıtlı bağlantı yok. Sağdaki formdan ilk bağlantınızı kurun.
              </Caption1>
            ) : snap.savedConnections.map((c) => (
              <div key={c.id} className={styles.connItem}
                onClick={() => {
                  setForm({ url: c.signalingUrl, code: c.code, password: '' });
                  // HWID zaten güvenilirse parolasız bağlanmayı dener
                  ctrl.connect({ url: c.signalingUrl, code: c.code, password: '' });
                }}>
                <PlugConnectedRegular />
                <Text className={styles.connLabel}>{c.label}</Text>
                <Tooltip content="Kaydı sil" relationship="label">
                  <Button appearance="subtle" size="small" icon={<DismissRegular />}
                    onClick={(e) => { e.stopPropagation(); ctrl.removeConnection(c.id); }} />
                </Tooltip>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.mainForm}>
          <Card className={styles.card}>
            <Subtitle2>Yeni Bağlantı</Subtitle2>
            <div className={styles.stack}>
              <Field label="Sunucu Adresi">
                <Input value={form.url} placeholder="wss://sizin-domaininiz.com"
                  onChange={(_e, d) => setForm({ ...form, url: d.value })} onKeyDown={onEnter} />
              </Field>
              <Field label="Kod">
                <Input value={form.code} placeholder="A3F9-K2LX" maxLength={16}
                  onChange={(_e, d) => setForm({ ...form, code: d.value })} onKeyDown={onEnter} />
              </Field>
              <Field label="Parola">
                <Input ref={passwordRef} type="password" value={form.password} placeholder="••••••••"
                  onChange={(_e, d) => setForm({ ...form, password: d.value })} onKeyDown={onEnter} />
              </Field>
              <Button appearance="primary" size="large" className={styles.connectBtn}
                disabled={snap.connecting} onClick={doConnect}>
                {snap.connecting ? 'Bağlanılıyor...' : 'Bağlan'}
              </Button>
              <Caption1 className={`${styles.status} ${snap.connectStatus.isErr ? styles.statusErr : ''}`}>
                {snap.connectStatus.msg}
              </Caption1>
            </div>
          </Card>
        </div>
      </div>

      {/* Video sahnesi */}
      <div className={styles.stage} style={{ display: snap.view === 'stage' ? 'block' : 'none' }}>
        <video ref={videoRef} className={styles.video} autoPlay playsInline />

        <div className={`${styles.topBar} ${snap.uiHidden ? styles.topBarHidden : ''}`}>
          <Caption1 className={styles.pill}>
            Yakalamak için tıklayın · <b>{hotkeyLabel}</b> ile çıkış
          </Caption1>
          <Caption1 className={styles.overlayInfo}>{snap.overlayInfo}</Caption1>
          <div className={styles.spacer} />
          <Button size="small" icon={<DataUsageRegular />}
            appearance={snap.statsOpen ? 'primary' : 'secondary'}
            onClick={() => ctrl.setStatsOpen(!snap.statsOpen)}>İstatistik</Button>
          <Button size="small" icon={<FullScreenMaximizeRegular />}
            appearance={snap.fullscreen ? 'primary' : 'secondary'}
            onClick={() => ctrl.toggleFullscreen()}>Tam Ekran</Button>
          <Button size="small" icon={<SettingsRegular />}
            appearance={snap.panelOpen ? 'primary' : 'secondary'}
            onClick={() => ctrl.setPanelOpen(!snap.panelOpen)}>Ayarlar</Button>
          <Button size="small" icon={<PlugDisconnectedRegular />}
            onClick={() => ctrl.showConnectView()}>Bağlantıyı Kes</Button>
        </div>

        {snap.statsOpen && snap.stats && (
          <div className={styles.statsBox}>
            {[['Çözünürlük', snap.stats.resolution], ['FPS', snap.stats.fps],
              ['Bit hızı', snap.stats.mbps + ' Mbps'], ['Gecikme (RTT)', snap.stats.rtt],
              ['Paket kaybı', snap.stats.loss], ['Jitter', snap.stats.jitter]].map(([k, v]) => (
              <div key={k} className={styles.statRow}>
                <Caption1 className={styles.hint}>{k}</Caption1>
                <Caption1 className={styles.statVal}>{v}</Caption1>
              </div>
            ))}
          </div>
        )}

        {snap.panelOpen && (
          <div className={styles.panel}>
            {snap.monitors.list.length > 1 && (
              <Field label="Monitör">
                <Dropdown value={currentMonitor ? currentMonitor.name : ''}
                  selectedOptions={snap.monitors.current ? [snap.monitors.current] : []}
                  onOptionSelect={(_e, d) => ctrl.setMonitor(d.optionValue)}>
                  {snap.monitors.list.map((m) => (
                    <Option key={m.id} value={m.id} text={m.name}>
                      {m.name}{m.primary ? ' (birincil)' : ''}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            )}

            <Field label="Mod">
              <RadioGroup value={prefs.mode} onChange={(_e, d) => ctrl.setMode(d.value)}>
                {MODES.map((m) => <Radio key={m.key} value={m.key} label={m.label} />)}
              </RadioGroup>
            </Field>

            <Field label="Kalite">
              <RadioGroup value={prefs.quality} onChange={(_e, d) => ctrl.setQuality(d.value)}>
                {QUALITIES.map((q) => <Radio key={q.key} value={q.key} label={q.label} />)}
              </RadioGroup>
            </Field>

            {prefs.quality === 'custom' && (
              <>
                <Field label="Ölçek">
                  <Input type="number" step="0.1" min="1" value={String(snap.custom.scale)}
                    onChange={(_e, d) => ctrl.setCustom({ scale: d.value })} />
                </Field>
                <Field label="FPS">
                  <Input type="number" step="1" min="10" max="60" value={String(snap.custom.fps)}
                    onChange={(_e, d) => ctrl.setCustom({ fps: d.value })} />
                </Field>
                <Field label="Bitrate (Mbps)">
                  <Input type="number" step="0.5" min="0.5" value={String(snap.custom.bitrate)}
                    onChange={(_e, d) => ctrl.setCustom({ bitrate: d.value })} />
                </Field>
                <Button appearance="primary" onClick={() => ctrl.sendCurrentSettings()}>Uygula</Button>
              </>
            )}

            <Body1Strong className={styles.sectionGap}>Yakalamadan Çıkış</Body1Strong>
            <Dropdown value={hotkeyLabel} selectedOptions={[prefs.releaseHotkey]}
              onOptionSelect={(_e, d) => ctrl.setReleaseHotkey(d.optionValue)}>
              {Object.entries(ctrl.RELEASE_HOTKEYS).map(([k, v]) => (
                <Option key={k} value={k} text={v.label}>{v.label}</Option>
              ))}
            </Dropdown>
            <Caption1 className={styles.hint}>
              Escape artık host'a iletiliyor (oyun menüleri için). Yakalamadan çıkmak için
              yukarıdaki kısayolu kullanın.
            </Caption1>

            <Body1Strong className={styles.sectionGap}>Seçenekler</Body1Strong>
            <Switch checked={prefs.clipboardSync !== false}
              onChange={(_e, d) => ctrl.setClipboardSync(d.checked)}
              label="Panoyu host ile eşitle" />
            <Switch checked={prefs.autoHideUi !== false}
              onChange={(_e, d) => ctrl.setAutoHideUi(d.checked)}
              label="Butonları 5 sn sonra gizle" />
            <Switch checked={!!prefs.hideUiCompletely}
              onChange={(_e, d) => ctrl.setHideUiCompletely(d.checked)}
              label="Yakalama sırasında butonları anında gizle" />
            <Switch checked={prefs.minimizeToTray !== false}
              onChange={(_e, d) => ctrl.setMinimizeToTray(d.checked)}
              label="Küçültünce sistem tepsisine in" />
          </div>
        )}
      </div>
    </>
  );
}
