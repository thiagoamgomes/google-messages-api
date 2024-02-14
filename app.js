const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { StorageProviderName } = require('puppeteer-extra-plugin-session')
const axios = require('axios')
const amqp = require('amqplib/callback_api')

const QRCode = require('qrcode');

const app = express();
const port = 3000;

const fs = require('fs')

puppeteer.use(StealthPlugin());
puppeteer.use(require('puppeteer-extra-plugin-session').default());

amqp.connect(process.env.RABBITMQ ?? 'amqp://localhost', async function (err, connection) {
    if (err) {
        console.log('Erro ao conectar RabbitMQ', err)

        return
    }

    console.log('Conectado ao RabbitMQ')

    connection.createChannel(function (err, channel) {
        if (err) {
            console.log(err);
            return;
        }

        global.instanceChannel = channel
    })

})

const axiosConfig = (method, url, headers, data = {}) => {
    return {
        method,
        url,
        maxBodyLength: Infinity,
        timeout: 1000 * 240,
        headers,
        data,
    };
}

(async () => {
    global.browserInstances = {};
    // Restante do código que depende de browserInstances
})();
 
async function createBrowserInstance(instanceName, webhook) {
    try {
        const browser = await puppeteer.launch({
            headless: 'new'
        });
        const page = await browser.newPage();

        await page.setViewport({
            width: 640,
            height: 480,
            deviceScaleFactor: 1,
          });

        await page.goto('https://messages.google.com/web/authentication');
        await page.waitForTimeout(5000);

        browserInstances[instanceName] = {
            instanceName,
            browser,
            page,
            webhook,
            phoneConnected: false
        };
    } catch(err) {
        console.log('Erro ao criar instância', err)
    }
}
 
async function waitForAuthentication(page, webhook, instanceName) {
    let Waiting = true

    while (Waiting) {
        if(!browserInstances[instanceName]){
            Waiting = false
            break
        }

        await page.waitForTimeout(5000);
        console.log('Aguardando conexão...')
        // Espera até que o elemento com o seletor 'mws-conversations-list' apareça na página
        try {
            const response = await page.waitForSelector('mws-conversations-list', {
                timeout: 5000
            });

            if (response !== null) {
                Waiting = false

                if (webhook !== null) {
                    try {
                        const config = axiosConfig(
                            "post",
                            webhook, {
                                "Content-Type": "application/json",
                            },
                            JSON.stringify({
                                event: 'phoneConnected',
                                instanceName: instanceName
                            })
                        );

                        await axios(config);
                    } catch (e) {
                        console.log('Erro ao enviar webhook', e)
                    }
                }

                console.log(`Instância ${instanceName} conectada!`)

                browserInstances[instanceName].phoneConnected = true                
                
                consumeMessages(`${instanceName}_queue`)                 

                checkUnreadConversations(page, instanceName, webhook)

                try {
                    await page.waitForSelector('button[data-e2e-remember-this-computer-confirm]', {
                        visible: true,
                        timeout: 25000
                    });
                    await page.click('button[data-e2e-remember-this-computer-confirm]');                                        
                    console.log('Botão clicado!');
                } catch (error) {                    
                    console.log('O botão não foi encontrado ou não está visível na página.');
                }

                console.log('Aguardando 10 segundos para salvar as configurações...')
                await page.waitForTimeout(10000);
                saveSessionData(page, instanceName, webhook)
            } else {
                console.log('Verificando novamente...')
            }
        } catch {

        }
    }
}

async function checkUnreadConversations(page, instanceName, webhook) {
    try{
        while (browserInstances[instanceName] && browserInstances[instanceName].phoneConnected === true) {
            await page.waitForTimeout(2000);
    
            const conversationItems = await page.$$('mws-conversation-list-item');
    
            for (const item of conversationItems) {
                const unRead = await item.$eval('a', anchor => anchor.getAttribute('data-e2e-is-unread'));
    
                if (unRead !== 'true') {
                    continue
                }
    
                const href = await item.$eval('a', anchor => anchor.getAttribute('href'));
                await item.click();
    
                await page.waitForSelector('mws-message-wrapper[is-last="true"]', { timeout: 0 });
    
                // await page.waitForTimeout(5000);
    
                // Obter o último elemento mws-message-wrapper
                const lastMessageElement = await page.$('mws-message-wrapper[is-last="true"]');
    
                // Se encontrar o elemento com is-last="true", imprimir o conteúdo no console
                if (lastMessageElement) {
                    const messageText = await lastMessageElement.$eval('.text-msg-content', el => el.textContent.trim());
                    console.log(`Última mensagem em ${href}: ${messageText}`);
    
                    const conversationId = extractConversationId(page.url());
    
                    // Clicar no elemento com a classe 'logo-link'
                    const logoLink = await page.$('.logo-link');
                    if (logoLink) {
                        await logoLink.click();
                    }
    
                    if(webhook !== null){
                        try{
                            const config = axiosConfig(
                                "post",
                                webhook, 
                                {
                                    "Content-Type": "application/json",
                                }, 
                                JSON.stringify({
                                    event: 'newMessage',
                                    instanceName: instanceName,
                                    message: messageText,
                                    chatId: conversationId
                                })
                            );     
                            
                            await axios(config);
                        } catch(e) {
                            console.log('Erro ao enviar webhook', e)
                        }        
                    }
                }
            }
    
            await page.waitForTimeout(2000); // Espera 5 segundos antes da próxima verificação
        }
    } catch {
        console.log('Erro ao verificar respostas')
    }
}
  
app.use(
    express.json({
        limit: "100mb",
    })
)

app.use(
    express.urlencoded({
        extended: true,
        limit: "100mb",
        parameterLimit: 2500000,
    })
)

app.get('/create-instance/:instanceName', async (req, res) => {
    const {
        instanceName
    } = req.params;
    const { webhook } = req.body

    try {
        if (browserInstances[instanceName]) {
            await browserInstances[instanceName].browser.close()
            delete browserInstances[instanceName]
        }

        await createBrowserInstance(instanceName, webhook);

        const qrCodeUrl = await browserInstances[instanceName].page.$eval('[data-qr-code]', qrCodeElement => qrCodeElement.getAttribute('data-qr-code'));

        console.log(`Instância '${instanceName}' criada. URL do QR Code:`, qrCodeUrl);
        const QRbase64 = await new Promise((resolve, reject) => {
            QRCode.toDataURL(qrCodeUrl, function (err, code) {
                if (err) {
                    reject(reject);
                    return;
                }
                resolve(code);
            });
        });
        

        res.status(200).json({
            success: true,
            instanceName,
            qrcode: QRbase64
        });

        await waitForAuthentication(browserInstances[instanceName].page, browserInstances[instanceName].webhook, instanceName)
    } catch (error) {
        console.error(`Erro ao criar instância '${instanceName}':`, error);
        res.status(500).json({
            success: false,
            error: `Erro ao criar instância '${instanceName}'`
        });
    }
});

app.post('/send-message/:instanceName', async (req, res) => {
  const { instanceName } = req.params;  

  if(!browserInstances[instanceName] || browserInstances[instanceName].phoneConnected === false){
    res.status(500).send({
        success: false,
        error: `Instância '${instanceName}' não conectada.`
    })

    return
  }

  if(!req.body){
    res.status(403).send({
        success: false,
        message: "Mensagem vazia"
    })

    return
  }

  const { phoneNumber, message } = req.body

  try {   
    const filaId = await getRandomInt(1, 99999999999); 
    const queueName = `${instanceName}_queue`;
    const channel = global.instanceChannel
    await channel.assertQueue(queueName, { durable: true });
    await channel.sendToQueue(queueName, Buffer.from(JSON.stringify({
        instanceName,
        phoneNumber,
        message,
        filaId
    })));
  
    res.status(200).json({
        success: true,
        message: "Adicionado a fila de envios",
        filaId 
    });
    
  } catch (error) {
    console.error(`Erro ao adicionar mensagem na fila. '${instanceName}':`, error);
    res.status(500).json({ success: false, error: `Erro ao adicionar mensagem na fila. '${instanceName}'` });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});


function extractConversationId(url) {
    const match = url.match(/\/conversations\/(\d+)$/);
    return match ? match[1] : null;
  }

async function sendMessage(instanceName, phoneNumber, message, filaId) {
    try {
        if (browserInstances[instanceName]) {
            const {
                page
            } = browserInstances[instanceName];

            await page.waitForSelector('div[class*="fab-label"]', {
                visible: true
            });

            const startChatButton = await page.$('div[class*="fab-label"]');

            await startChatButton.click();

            await page.waitForSelector('input[data-e2e-contact-input]', {
                visible: true
            });

            const inputField = await page.$('input[data-e2e-contact-input]');

            await inputField.type(phoneNumber);

            await page.waitForSelector('button[data-e2e-send-to-button]', {
                visible: true
            });

            await page.click('button[data-e2e-send-to-button]');

            await page.waitForSelector('textarea[data-e2e-message-input-box]', {
                visible: true
            });

            await page.type('textarea[data-e2e-message-input-box]', message);

            await page.waitForSelector('button[data-e2e-send-text-button]', {
                visible: true
            });

            await page.click('button[data-e2e-send-text-button]');

            await page.waitForTimeout(2000);

            const conversationId = extractConversationId(page.url());
            console.log(`ID da Conversa após envio de mensagem: ${conversationId}`);

            return {
                success: true,
                instanceName,
                phoneNumber,
                message,
                chatId: conversationId,
                filaId
            };
        } else {
            console.error(`Instância '${instanceName}' não encontrada.`);
            return {
                success: false,
                error: `Instância '${instanceName}' não encontrada.`
            };
        }
    } catch (error) {
        console.error(`Erro ao enviar mensagem na instância '${instanceName}':`, error);
        return {
            success: false,
            error: `Erro ao enviar mensagem na instância '${instanceName}'`
        };
    }
}


function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min)) + min;
  }

// Função para verificar se o QR Code reapareceu na página
async function verificarDesconexao() {
    Object.keys(browserInstances).forEach(async instanceName => {
        if (browserInstances[instanceName] && browserInstances[instanceName].phoneConnected === true) {
            try {
                const qrCodePresente = await browserInstances[instanceName].page.$eval('[data-qr-code]', qrCodeElement => qrCodeElement.getAttribute('data-qr-code'));

                // Se o QR Code reaparecer, indica uma desconexão
                if (qrCodePresente) {
                    console.log('QR Code reapareceu. Possível desconexão.');

                    if (browserInstances[instanceName].webhook !== null) {
                        try {
                            const config = axiosConfig(
                                "post",
                                browserInstances[instanceName].webhook, {
                                    "Content-Type": "application/json",
                                },
                                JSON.stringify({
                                    event: 'phoneDisconnected',
                                    instanceName: instanceName
                                })
                            );

                            await axios(config);
                        } catch (e) {
                            console.log('Erro ao enviar webhook', e)
                        }
                    }

                    // Tomar medidas para lidar com a desconexão, como recarregar a página
                    await browserInstances[instanceName].browser.close();
                    delete browserInstances[instanceName];

                }
            } catch {

            }
        }
    })
}

// Rotina para verificar a desconexão a cada 5 segundos
setInterval(() => {
    verificarDesconexao();
}, 5000);

async function consumeMessages(queueName) {
    try {
        const channel = global.instanceChannel
        await channel.assertQueue(queueName, {
            durable: true
        });

        console.log(`Consumindo mensagens da fila ${queueName}...`);

        channel.prefetch(1);

        channel.consume(
            queueName,
            async function (data) {
                if (data.content) {
                    try {
                        const json = JSON.parse(data.content.toString());
                        await sendMessage(json.instanceName, json.phoneNumber, json.message, json.filaId)                        
                        channel.ack(data);
                    } catch (err) {
                        console.log(err)
                        channel.nack(data);
                    }
                }
            }, {
                noAck: false,
            }
        );
    } catch (error) {
        console.error('Erro ao consumir mensagens:', error);
    }
}

async function saveSessionData(page, instanceName, webhook) {
    try {
        const sessionData = await page.session.dump();
        sessionData.webhook = webhook
    
        fs.writeFileSync(`./instances/${instanceName}.json`, JSON.stringify(sessionData, null, 2));
    } catch (e) {
        console.log(e)
    }
}

async function restoreSessionData(instanceName) {
    try {
        const sessionData = JSON.parse(fs.readFileSync(`./instances/${instanceName}.json`, 'utf8'));
        const webhook = sessionData.webhook

        delete sessionData.webhook

        await createBrowserInstance(instanceName, webhook)

        await browserInstances[instanceName].page.session.restore(sessionData);

        await browserInstances[instanceName].page.goto('https://messages.google.com/web/conversations')

        await waitForAuthentication(browserInstances[instanceName].page, webhook, instanceName)
    } catch(err) {
        console.log(err)

    }
}

loadAllInstances()
 
// Função para carregar todos os arquivos JSON na pasta instances
async function loadAllInstances() {
    try {
        fs.readdir('./instances', async (err, files) => {
            if(err){
                console.log(err)
                return
            }
            for (const file of files) {                
                const instanceName = file.replace('.json', '');
                console.log('Restaurando instância ', instanceName)
                await restoreSessionData(instanceName);
            }
        })         
    } catch (error) {
        console.error('Erro ao carregar as instâncias:', error);
    }
}
