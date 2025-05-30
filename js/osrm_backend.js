
let mapa = L.map('map').setView([-20.536479, -47.405637], 19);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(mapa);

let rotaLayer, marcadorUsuario;
let destinoCoords = null;
let instrucoesDiv = document.getElementById("instrucoes");

async function calcularRota() {
  const origem = document.getElementById('origem').value;
  const destino = document.getElementById('destino').value;

  const resposta = await fetch('https://busy-sawfly-new.ngrok-free.app/route_request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origem, destino })
  });

  const dados = await resposta.json();
  if (dados.error) return alert("Erro: " + dados.error);

  if (rotaLayer) mapa.removeLayer(rotaLayer);
  rotaLayer = L.geoJSON(dados.rota).addTo(mapa);
  mapa.fitBounds(rotaLayer.getBounds());

  document.getElementById('distancia').innerText = dados.distancia;
  document.getElementById('duracao').innerText = dados.duracao;

  const km = parseFloat(dados.distancia);
  let precoCarro  = 0.2 + km * 2;
  let precoMoto   = 0.2 + km * 1.5;
  let entregaCarro = 2.2 + km * 2;
  let entregaMoto  = 2.2 + km * 1.5;

  // ← alteração promocional
  const agora = new Date();
  const hora = agora.getHours();
  const minuto = agora.getMinutes();
  const minutosAgora = hora * 60 + minuto;

  if (minutosAgora >= 420 && minutosAgora < 450) { // 07:00 - 07:30
    precoCarro -= 3.5;
    precoMoto  -= 3.5;
    entregaCarro -= 3.5;
    entregaMoto  -= 3.5;
  } else if (minutosAgora >= 660 && minutosAgora < 720) { // 11:00 - 12:00
    precoCarro -= 2.5;
    precoMoto  -= 2.5;
    entregaCarro -= 2.5;
    entregaMoto  -= 2.5;
  } else if (minutosAgora >= 750 && minutosAgora < 780) { // 12:30 - 13:00
    precoCarro += 1.5;
    precoMoto  += 1.5;
    entregaCarro += 1.5;
    entregaMoto  += 1.5;
  }
  // ← fim da alteração promocional

  document.getElementById('preco-carro').innerText = precoCarro.toFixed(2);
  document.getElementById('preco-moto').innerText = precoMoto.toFixed(2);
  document.getElementById('entrega-carro').innerText = entregaCarro.toFixed(2);
  document.getElementById('entrega-moto').innerText = entregaMoto.toFixed(2);

  categoriasCache.find(c => c.id === 'corrida-carro').preco = precoCarro;
  categoriasCache.find(c => c.id === 'corrida-moto').preco = precoMoto;
  categoriasCache.find(c => c.id === 'entrega-carro').preco = entregaCarro;
  categoriasCache.find(c => c.id === 'entrega-moto').preco = entregaMoto;

  exibirListaCategorias();
  atualizarPrecosCatalogo();
  document.getElementById('info-motorista').style.display = 'block';
  iniciarGPS(destino);
}

    function usarMinhaLocalizacao(){
      if(navigator.geolocation){
        navigator.geolocation.getCurrentPosition(async pos=>{
          const{latitude,longitude}=pos.coords;
          const url=`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`;
          try{
            const response=await fetch(url,{headers:{'User-Agent':'VaiRapidoApp/1.0'}});
            const data=await response.json();
            if(data&&data.display_name){
              document.getElementById('origem').value=data.display_name;
              if(marcadorUsuario)mapa.removeLayer(marcadorUsuario);
              marcadorUsuario=L.marker([latitude,longitude],{
                icon:L.divIcon({className:'pulse-icon',html:`<div class="pulse-wrapper"><div class="pulse-circle"></div><img src="/img/carro.png" class="pulse-img"></div>`,iconSize:[40,40],iconAnchor:[20,40],popupAnchor:[0,-40]})
              }).addTo(mapa).bindPopup("Você está aqui");
              mapa.setView([latitude,longitude],15);
              const destino=document.getElementById('destino').value;
              if(destino.trim()!==''){calcularRota();}
            }else{alert("Não foi possível encontrar um endereço para sua localização.");}
          }catch(error){
            console.error("Erro ao buscar endereço:",error);
            alert("Erro ao buscar o endereço da localização.");
          }
        });
      }else{alert("Geolocalização não suportada.");}
    }

    function iniciarGPS(dest){
      buscarCoordenadas(dest).then(destCoords=>{
        destinoCoords=destCoords;
        if(!destinoCoords){alert("Destino inválido.");return;}

        navigator.geolocation.watchPosition(async pos=>{
          const lat=pos.coords.latitude,lon=pos.coords.longitude;
          if(marcadorUsuario)mapa.removeLayer(marcadorUsuario);
          marcadorUsuario=L.marker([lat,lon]).addTo(mapa).bindPopup("Você").openPopup();
          mapa.setView([lat,lon],13);

          const rota=await calcularRotaOSRM(lat,lon,destinoCoords[0],destinoCoords[1]);
          if(!rota)return;
          if(rotaLayer)mapa.removeLayer(rotaLayer);
          rotaLayer=L.geoJSON(rota.geojson).addTo(mapa);
          mostrarInstrucoes(rota.instrucoes);
        },erro=>{alert("Erro ao obter localização: "+erro.message);},{enableHighAccuracy:true,maximumAge:1000});
      });
    }

    async function calcularRotaOSRM(origLat,origLon,destLat,destLon){
      const url=`http://localhost:5000/route/v1/driving/${origLon},${origLat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true`;
      const response=await fetch(url);
      const data=await response.json();
      if(!data.routes||data.routes.length===0)return null;

      const steps=data.routes[0].legs[0].steps;
      const instrucoes=steps.map(step=>{
        const tipo=step.maneuver.type;
        const direcao=step.maneuver.modifier||'';
        const rua=step.name||'';
        let acao='',classe='';
        switch(tipo){
          case'turn':
            if(direcao==='left'){acao='Vire à esquerda';classe='left';}
            else if(direcao==='right'){acao='Vire à direita';classe='right';}
            else{acao='Vire';classe='turn';}
            break;
          case'new name':acao='Continue na via';classe='continue';break;
          case'depart':acao='Comece na';classe='depart';break;
          case'arrive':acao='Você chegou ao destino';classe='arrive';break;
          case'merge':acao='Entre na via';classe='merge';break;
          case'roundabout':acao='Pegue a rotatória';classe='roundabout';break;
          case'continue':acao='Continue em frente';classe='continue';break;
          default:acao=tipo;classe='default';
        }
        return{acao:`${acao}${rua?' na '+rua:''}`.trim(),classe};
      });

      return{geojson:{type:"Feature",geometry:data.routes[0].geometry},instrucoes};
    }

    function mostrarInstrucoes(instr){
      if(instrucoesDiv){
        instrucoesDiv.innerHTML="<h4>Instruções:</h4><ol>";
        instr.forEach(ins=>{
          const li=document.createElement("li");
          const iconDiv=document.createElement("div");
          iconDiv.className=`direcao-icon ${ins.classe}`;
          li.appendChild(iconDiv);li.appendChild(document.createTextNode(ins.acao));
          instrucoesDiv.appendChild(li);
        });
        instrucoesDiv.innerHTML+="</ol>";
      }
    }

    async function buscarCoordenadas(dest){
      const url=`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(dest)}`;
      try{
        const resp=await fetch(url);
        const data=await resp.json();
        if(data&&data.length>0){return[parseFloat(data[0].lat),parseFloat(data[0].lon)];}
        else{return null;}
      }catch(e){console.error("Erro ao buscar coordenadas:",e);return null;}
    }
/* —————————————— CATÁLOGO & PEDIDO CORRIDAS —————————————— */
const categoriasCache = [
  {id:'corrida-carro', slug:'carro',        nome:'Corrida (Carro)', preco:0, precoId:'preco-carro'},
  {id:'corrida-moto',  slug:'moto',         nome:'Corrida (Moto)',  preco:0, precoId:'preco-moto'},
  {id:'entrega-carro', slug:'entrega-carro',nome:'Entrega (Carro)', preco:0, precoId:'entrega-carro'},
  {id:'entrega-moto',  slug:'entrega-moto', nome:'Entrega (Moto)',  preco:0, precoId:'entrega-moto'}
];

let countdownInterval = null;

/* —— FUNÇÕES DE EXIBIÇÃO —— */
function exibirListaCategorias() {
  const lista = document.getElementById('listaCategorias');
  if (!lista) return;
  lista.innerHTML = '';
  lista.style.display = 'flex';
  categoriasCache.forEach(cat => {
    const img = document.createElement('img');
    img.src  = cat.slug.includes('carro') ? '/img/carro.png' : '/img/moto.png';
    img.alt  = cat.slug.includes('carro') ? 'Carro' : 'Moto';
    img.style.width = '100px';

    const div = document.createElement('div');
    div.className = 'categoria';
    div.innerHTML = `
      <h3>${cat.nome}</h3>
      <p>Preço: R$ <strong id="${cat.precoId}">${cat.preco.toFixed(2)}</strong></p>
      <button type="button" onclick="selecionarCategoria('${cat.id}')">Selecionar</button>`;
    div.insertBefore(img, div.children[1]);
    lista.appendChild(div);
  });
}

function atualizarPrecosCatalogo() {
  categoriasCache.forEach(cat => {
    const span = document.getElementById(`preco-${cat.id}`);
    if (span) span.textContent = cat.preco.toFixed(2);
  });
}

/* —— SELEÇÃO DE CATEGORIA —— */
function selecionarCategoria(catId) {
  prepararChamadaMotorista();   // oculta catálogo / inputs e inicia cronômetro
}
function prepararChamadaMotorista() {
  /* Oculta catálogo e inputs */
  const lista = document.getElementById('listaCategorias');
  if (lista) lista.style.display = 'none';

  const infoMotorista = document.getElementById('info-motorista');
  if (infoMotorista) infoMotorista.style.display = 'none';

  ['origem','destino'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display='none';

    const label = document.querySelector(`label[for="${id}"]`);
    if(label) label.style.display = 'none';
  });

  ['btn-calcular-rotas','btn-localizacao'].forEach(cls=>{
    const btn=document.querySelector(`.${cls}`);
    if(btn) btn.style.display='none';
  });

  /* Cronômetro */
  let timerBox = document.getElementById('timerBox');
  if (!timerBox) {
    timerBox = document.createElement('div');
    timerBox.id = 'timerBox';
    timerBox.style.position   = 'fixed';
    timerBox.style.top        = '50%';
    timerBox.style.left       = '50%';
    timerBox.style.transform  = 'translate(-50%, -50%)';
    timerBox.style.background = '#fff';
    timerBox.style.padding    = '20px';
    timerBox.style.borderRadius = '8px';
    timerBox.style.textAlign  = 'center';
    timerBox.style.fontFamily = 'sans-serif';
    timerBox.style.zIndex     = '9999';
    document.body.appendChild(timerBox);
  }
  timerBox.innerHTML = `
    <h2 id="cronometro">00:03:00</h2>
    <p>Solicitando um motorista...</p>
    <form>
      <button id="cancelarPedido" style="
        background-color: red;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 5px;
        font-size: 16px;
        cursor: pointer;
        margin-top: 10px;
      ">Cancelar Pedido</button>
    </form>
  `;
  timerBox.style.display = 'block';

  iniciarCronometro(180);
}

function iniciarCronometro(segundos) {
  clearInterval(countdownInterval);
  const cronometroEl = document.getElementById('cronometro');
  if (!cronometroEl) return;

  /* áudio */
  let audio = document.getElementById('audioAlerta');
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = 'audioAlerta';
    audio.src = '/audio/alerta.mp3';   // ajuste o caminho real
    audio.preload = 'auto';
    document.body.appendChild(audio);
  }

  function formatar(s) {
    const h  = Math.floor(s / 3600);
    const m  = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${ss.toString().padStart(2,'0')}`;
  }

  cronometroEl.textContent = formatar(segundos);

  countdownInterval = setInterval(() => {
    segundos--;
    cronometroEl.textContent = formatar(Math.max(segundos, 0));
    if (segundos <= 0) {
      clearInterval(countdownInterval);
      audio.play();
    }
  }, 1000);
}

/* —— INICIALIZAÇÃO —— */
exibirListaCategorias();

function enviarPedido(nome, origem, destino, duracao, distancia, valor, categoria) {
  fetch('https://busy-sawfly-new.ngrok-free.app/pedido-corrida', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, origem, destino, duracao, distancia, valor, categoria })
  })
  .then(res => res.json())
  .then(data => {
    if (data.sucesso) {
      alert('Pedido enviado com sucesso!');
    } else {
      alert('Erro: ' + data.mensagem);
    }
  })
  .catch(err => {
    alert('Erro na requisição');
    console.error(err);
  });
}

