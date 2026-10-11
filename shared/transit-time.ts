/** Convert a wall-clock departure using an explicit destination timezone. */
export function transitDeparture(local: string, zone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('time');
  const target = Date.parse(local + ':00Z');
  if (!Number.isFinite(target)) throw new Error('time');
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
  const wall = (n:number) => {
    const parts = Object.fromEntries(fmt.formatToParts(n).map(p=>[p.type,p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  // Reject DST gaps and ambiguous repeated times instead of silently guessing.
  const matches:number[]=[];
  for (let offset=-14*60;offset<=14*60;offset+=15) {
    const candidate=target-offset*60000;
    if(wall(candidate)===local)matches.push(candidate);
  }
  if(matches.length!==1)throw new Error('ambiguous_time');
  return new Date(matches[0]).toISOString();
}

/** Existing legacy JPY estimates apply only to the original Tokyo/Osaka pilot. */
export function hasJapaneseFareEstimate(a:{lat:number;lng:number},b:{lat:number;lng:number}) {
  const inside=(p:{lat:number;lng:number}) => (p.lat>=35.3 && p.lat<=36.1 && p.lng>=139.2 && p.lng<=140.2) || (p.lat>=34.3 && p.lat<=35.2 && p.lng>=135 && p.lng<=136);
  return inside(a)&&inside(b);
}
