const ws = new WebSocket("wss://mainnet-ws1.bulk.trade");
let n=0, t0=Date.now();
ws.onopen = () => ws.send(JSON.stringify({method:"subscribe",subscription:[{type:"ticker",symbol:"PUMP-USD"}]}));
ws.onmessage = (e) => { const m=JSON.parse(e.data); if(m.type!=="ticker")return; n++; const k=m.data.ticker; if(n<=1) console.log(JSON.stringify(m)); if(n<=8) console.log(Date.now()-t0, k.markPrice, k.oraclePrice, k.fairBookPx, k.lastPrice); };
setTimeout(()=>{ console.log("n",n); process.exit(0); }, 5000);
