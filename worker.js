const TOKEN = ENV_BOT_TOKEN // Get it from @BotFather
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET // A-Z, a-z, 0-9, _ and -
const ADMIN_UID = ENV_ADMIN_UID // your user id, get it from https://t.me/username_to_id_bot

const NOTIFY_INTERVAL = 3600 * 1000;
const fraudDb = 'https://raw.githubusercontent.com/cqd5686/tgbot/main/data/fraud.db';
const notificationUrl = 'https://raw.githubusercontent.com/cqd5686/tgbot/main/data/notification.txt'
const startMsgUrl = 'https://raw.githubusercontent.com/cqd5686/tgbot/main/data/startMessage.md';

const enable_notification = false
/**
 * Return url to telegram api, optionally with parameters added
 */
function apiUrl (methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null){
  return fetch(apiUrl(methodName, params), body)
    .then(r => r.json())
}

function makeReqBody(body){
  return {
    method:'POST',
    headers:{
      'content-type':'application/json'
    },
    body:JSON.stringify(body)
  }
}

function sendMessage(msg = {}){
  return requestTelegram('sendMessage', makeReqBody(msg))
}

function copyMessage(msg = {}){
  return requestTelegram('copyMessage', makeReqBody(msg))
}

function forwardMessage(msg){
  return requestTelegram('forwardMessage', makeReqBody(msg))
}

/**
 * Wait for requests to the worker
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else {
    event.respondWith(new Response('No handler for this request'))
  }
})

/**
 * Handle requests to WEBHOOK
 * https://core.telegram.org/bots/api#update
 */
async function handleWebhook (event) {
  // Check secret
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 })
  }

  // Read request body synchronously
  const update = await event.request.json()
  // Deal with response asynchronously
  event.waitUntil(onUpdate(update))

  return new Response('Ok')
}

/**
 * Handle incoming Update
 * https://core.telegram.org/bots/api#update
 */
async function onUpdate (update) {
  if ('message' in update) {
    await onMessage(update.message)
  }
}

/**
 * Handle incoming Message
 * https://core.telegram.org/bots/api#message
 */
async function onMessage (message) {
  if(message.text === '/start'){
    let startMsg = await fetch(startMsgUrl).then(r => r.text())
    return sendMessage({
      chat_id:message.chat.id,
      text:startMsg,
	    //text:'欢迎使用 Daki的千里传音，我会将你的私聊立刻送达！'
    })
  }
  if(message.chat.id.toString() === ADMIN_UID){
    if(/^\/addkw(\s+|$)/.exec(message.text || '')){
      return handleAddKeyword(message)
    }
    if(/^\/delkw(\s+|$)/.exec(message.text || '')){
      return handleDelKeyword(message)
    }
    if(/^\/listkw$/.exec(message.text || '')){
      return handleListKeyword(message)
    }
    if(!message?.reply_to_message?.chat){
      return sendMessage({
        chat_id:ADMIN_UID,
        text:'使用方法，回复转发的消息，并发送回复消息。\n常用指令\n/block：屏蔽\n/unblock：解除屏蔽\n/checkblock ：检测屏蔽\n/addkw <关键字>：添加过滤词\n/delkw <关键字>：删除过滤词\n/listkw：查看过滤词'
      })
    }
    if(/^\/block$/.exec(message.text)){
      return handleBlock(message)
    }
    if(/^\/unblock$/.exec(message.text)){
      return handleUnBlock(message)
    }
    if(/^\/checkblock$/.exec(message.text)){
      return checkBlock(message)
    }
    let guestChantId = await cqd.get('msg-map-' + message?.reply_to_message.message_id,
                                      { type: "json" })
    return copyMessage({
      chat_id: guestChantId,
      from_chat_id:message.chat.id,
      message_id:message.message_id,
    })
  }
  return handleGuestMessage(message)
}

async function handleGuestMessage(message){
  let chatId = message.chat.id;
  let isblocked = await cqd.get('isblocked-' + chatId, { type: "json" })

  if(isblocked){
    return sendMessage({
      chat_id: chatId,
      text:'Your are blocked'
    })
  }

  let hitKeyword = await checkKeyword(message.text || message.caption || '')
  if(hitKeyword){
    await cqd.put('isblocked-' + chatId, true)
    return
  }

  let forwardReq = await forwardMessage({
    chat_id:ADMIN_UID,
    from_chat_id:message.chat.id,
    message_id:message.message_id
  })
  console.log(JSON.stringify(forwardReq))
  if(forwardReq.ok){
    await cqd.put('msg-map-' + forwardReq.result.message_id, chatId)
  }
  return handleNotify(message)
}

async function handleNotify(message){
  // 先判断是否是诈骗人员，如果是，则直接提醒
  // 如果不是，则根据时间间隔提醒：用户id，交易注意点等
  let chatId = message.chat.id;
  if(await isFraud(chatId)){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:`检测到骗子，UID${chatId}`
    })
  }
  if(enable_notification){
    let lastMsgTime = await cqd.get('lastmsg-' + chatId, { type: "json" })
    if(!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL){
      await cqd.put('lastmsg-' + chatId, Date.now())
      return sendMessage({
        chat_id: ADMIN_UID,
        text:await fetch(notificationUrl).then(r => r.text())
      })
    }
  }
}

async function handleBlock(message){
  let guestChantId = await cqd.get('msg-map-' + message.reply_to_message.message_id,
                                      { type: "json" })
  if(guestChantId === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:'不能屏蔽自己'
    })
  }
  await cqd.put('isblocked-' + guestChantId, true)

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId}屏蔽成功`,
  })
}

async function handleUnBlock(message){
  let guestChantId = await cqd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })

  await cqd.put('isblocked-' + guestChantId, false)

  return sendMessage({
    chat_id: ADMIN_UID,
    text:`UID:${guestChantId}解除屏蔽成功`,
  })
}

async function checkBlock(message){
  let guestChantId = await cqd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })
  let blocked = await cqd.get('isblocked-' + guestChantId, { type: "json" })

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId}` + (blocked ? '被屏蔽' : '没有被屏蔽   ')
  })
}

/**
 * Send plain text message
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendPlainText (chatId, text) {
  return sendMessage({
    chat_id: chatId,
    text
  })
}

/**
 * Set webhook to this worker's url
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook (event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Remove webhook
 * https://core.telegram.org/bots/api#setwebhook
 */
async function unRegisterWebhook (event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

async function isFraud(id){
  id = id.toString()
  let db = await fetch(fraudDb).then(r => r.text())
  let arr = db.split('\n').filter(v => v)
  console.log(JSON.stringify(arr))
  let flag = arr.filter(v => v === id).length !== 0
  console.log(flag)
  return flag
}

async function getKeywords(){
  return (await cqd.get('keywords', { type: "json" })) || []
}

async function checkKeyword(text){
  if(!text) return null
  let kws = await getKeywords()
  return kws.find(k => text.includes(k)) || null
}

async function handleAddKeyword(message){
  let kw = message.text.replace(/^\/addkw\s*/, '').trim()
  if(!kw){
    return sendMessage({ chat_id: ADMIN_UID, text: '用法: /addkw <关键字>' })
  }
  let kws = await getKeywords()
  if(kws.includes(kw)){
    return sendMessage({ chat_id: ADMIN_UID, text: `关键字"${kw}"已存在` })
  }
  kws.push(kw)
  await cqd.put('keywords', JSON.stringify(kws))
  return sendMessage({ chat_id: ADMIN_UID, text: `已添加关键字: ${kw}\n当前共 ${kws.length} 个` })
}

async function handleDelKeyword(message){
  let kw = message.text.replace(/^\/delkw\s*/, '').trim()
  if(!kw){
    return sendMessage({ chat_id: ADMIN_UID, text: '用法: /delkw <关键字>' })
  }
  let kws = await getKeywords()
  let idx = kws.indexOf(kw)
  if(idx === -1){
    return sendMessage({ chat_id: ADMIN_UID, text: `关键字"${kw}"不存在` })
  }
  kws.splice(idx, 1)
  await cqd.put('keywords', JSON.stringify(kws))
  return sendMessage({ chat_id: ADMIN_UID, text: `已删除关键字: ${kw}\n当前共 ${kws.length} 个` })
}

async function handleListKeyword(message){
  let kws = await getKeywords()
  let text = kws.length === 0
    ? '当前无关键字'
    : `当前关键字 (${kws.length} 个):\n` + kws.map((k, i) => `${i + 1}. ${k}`).join('\n')
  return sendMessage({ chat_id: ADMIN_UID, text })
}
