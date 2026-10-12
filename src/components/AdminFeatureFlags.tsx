import {useEffect,useState} from 'react';
import {api} from '../api';
import {useT} from '../i18n';
import {DEFAULT_FEATURE_FLAGS,featureFlags,type FeatureFlags} from '../../shared/featureFlags';
export default function AdminFeatureFlags() {
 const {lang}=useT(), ms=lang==='ms';
 const [flags,setFlags]=useState(DEFAULT_FEATURE_FLAGS),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{api.get('/settings/features').then(r=>{setFlags(featureFlags(r));setReady(true);}).catch(()=>setMessage(ms?'Gagal memuatkan tetapan.':'Could not load feature settings.'));},[]);
 const labels: Record<keyof FeatureFlags,string> = {transitGeoapify:'Geoapify transit preview',transitGoogleEmbed:'Google transit map embed',transitGoogleLink:'Google Maps link in transit popup'};
 return <section className="card" style={{marginBottom:20}}><div className="cardhead"><h3>{ms?'Ciri percubaan':'Experimental features'}</h3></div>
 <p className="hint">{ms?'Tetapan ini terpakai kepada semua pengguna. Pilihan transit dimatikan secara lalai. Panduan kereta api Tokyo kekal tersedia.':'Applies to all users. Transit previews are off by default. Tokyo train directions remain available.'}</p>
 {Object.keys(labels).map(key=>{const k=key as keyof FeatureFlags;return <label className="row" key={k} style={{gap:10,marginBottom:12}}><input type="checkbox" style={{width:18,height:18}} checked={flags[k]} disabled={!ready||busy} onChange={e=>setFlags({...flags,[k]:e.target.checked})}/>{labels[k]}</label>;})}
 <button className="btn sm" disabled={!ready||busy} onClick={async()=>{setBusy(true);setMessage('');try{setFlags(featureFlags(await api.put('/settings/features',flags)));setMessage(ms?'Disimpan. Buka semula popup transit untuk menggunakan tetapan.':'Saved. Reopen transit options to apply these settings.');}catch{setMessage(ms?'Gagal menyimpan.':'Could not save settings.');}finally{setBusy(false);}}}>{busy?(ms?'Menyimpan…':'Saving…'):(ms?'Simpan ciri':'Save features')}</button>
 {message&&<p role="status">{message}</p>}</section>;
}
