const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('web/seasonal.js', 'utf8');
const classes = new Set(), nodes = [], listeners = {}, timers = new Map();
let now = new Date("2026-11-19T12:00:00").getTime(), sequence = 0, watching = false;
const list = {toggle:(name,on)=>on?classes.add(name):classes.delete(name),remove:(...names)=>names.forEach(name=>classes.delete(name)),add:name=>classes.add(name)};
const parent = {append:node=>nodes.push(node),getBoundingClientRect:()=>({top:900,bottom:500})};
const secondary = {...parent,previousElementSibling:parent,parentElement:parent};
const document = {hidden:false,documentElement:{classList:list},querySelector:s=>s==='.nav-secondary'?secondary:parent,
 createElement:()=>({setAttribute(){},append(){},addEventListener(){},remove(){nodes.splice(nodes.indexOf(this),1);}}),addEventListener:(type,fn)=>listeners[type]=fn};
class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}}
vm.runInNewContext(source,{document,Date:Clock,window:{addEventListener:(type,fn)=>listeners[type]=fn},
 ResizeObserver:class{constructor(){}observe(){watching=true;}disconnect(){watching=false;}},
 setTimeout:(fn,ms)=>{assert(ms>0&&ms<=25*3600000);timers.set(++sequence,{fn,ms});return sequence;},clearTimeout:id=>timers.delete(id)});
function check(date,active){now=new Date(date).getTime();listeners.focus();assert.equal(classes.has('season-solstice'),active,date);assert.equal(nodes.length,active?4:0);assert.equal(watching,active);assert.equal(timers.size,1);}
for(const year of [2025,2026,2027,2028]){
 check(`${year}-01-08T23:59:59`,true);check(`${year}-01-09T00:00:00`,false);
 check(`${year}-11-19T23:59:59`,false);check(`${year}-11-20T00:00:00`,true);
 check(`${year}-12-31T23:59:59`,true);
}
check('2026-11-21T12:00:00',true);
listeners.focus();assert.equal(nodes.length,4,'No duplicates on resume');assert.equal(timers.size,1);
document.hidden=true;listeners.visibilitychange();assert.equal(timers.size,0,'No timer while hidden');
now=new Date('2027-01-09T08:00:00').getTime();document.hidden=false;listeners.visibilitychange();
assert.equal(nodes.length,0,'Remove decorations after sleep across season end');
check('2027-11-19T23:59:59',false);now=new Date('2027-11-20T00:00:01').getTime();[...timers.values()][0].fn();assert.equal(nodes.length,4,'Start at local midnight');
console.log('Seasonal: annual boundaries, midnight, sleep/resume, removal, no duplicates, one daily timer.');
