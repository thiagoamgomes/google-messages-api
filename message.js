const { setTimeout } = require('timers');

const { axiosConfig, enviarWebhook } = require('./webhook')

const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function checkUnreadConversations(instanceName) {
    try{
        console.log('Iniciando leitura das respostas...')
        while (browserInstances[instanceName] && browserInstances[instanceName].phoneConnected === true && browserInstances[instanceName].enableAnswer === true) {            
            const page = browserInstances[instanceName].page
            const webhook = browserInstances[instanceName].webhook

            const conversationItems = await page.$$('mws-conversation-list-item');
    
            for (const item of conversationItems) {                
                const unRead = await item.$eval('a', anchor => anchor.getAttribute('data-e2e-is-unread'));
    
                if (unRead !== 'true') {
                    continue
                }

                if(browserInstances[instanceName] && browserInstances[instanceName].enableAnswer === false){
                    break;
                }

                console.log('Lendo...')
    
                const href = await item.$eval('a', anchor => anchor.getAttribute('href'));
                await item.click();

                if(browserInstances[instanceName] && browserInstances[instanceName].enableAnswer === false){
                    break;
                }
    
                await page.waitForSelector('mws-message-wrapper[is-last="true"]', { timeout: 0 });
    
    
                // Obter o último elemento mws-message-wrapper
                const lastMessageElement = await page.$('mws-message-wrapper[is-last="true"]');

                if(browserInstances[instanceName] && browserInstances[instanceName].enableAnswer === false){
                    break;
                }
    
                // Se encontrar o elemento com is-last="true", imprimir o conteúdo no console
                if (lastMessageElement) {
                    const messageText = await lastMessageElement.$eval('.text-msg-content', el => el.textContent.trim());
                    

                    if(browserInstances[instanceName] && browserInstances[instanceName].enableAnswer === false){
                        break;
                    }
    
                    const conversationId = extractConversationId(page.url());

                    enviarWebhook(webhook, 'newMessage', instanceName, {
                        message: messageText,
                        chatId: conversationId
                    })

                    if(browserInstances[instanceName] && browserInstances[instanceName].enableAnswer === false){
                        break;
                    }
    
                    // Clicar no elemento com a classe 'logo-link'
                    const logoLink = await page.$('.logo-link');
                    if (logoLink) {
                        await logoLink.click();
                    }

                    if(browserInstances[instanceName] && browserInstances[instanceName].enableAnswer === false){
                        break;
                    }
                    
                }
            }
    
            setTimeout(() => {}, 2000)
        }

        console.log('Parado a leitura das respostas', instanceName)
    } catch(e) {
        
    }
}

function extractConversationId(url) {
    const match = url.match(/\/conversations\/(\d+)$/);
    return match ? match[1] : null;
}

async function sendMessage({ instanceName, phoneNumber, message, attachmentPath = null, messageType = 'text' }, filaId) {
    try {
        if (browserInstances[instanceName]) {
            const {
                page,
                webhook
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
            
            await page.screenshot({path: `./screenshots/${generateRandomString(8)}.png`});
            
            if (messageType === 'text') {
                await page.type('textarea[data-e2e-message-input-box]', message);

            } else if (messageType === 'attachment') {    
                
                await page.screenshot({path: `./screenshots/${generateRandomString(8)}.png`});

                const [fileChooser] = await Promise.all([
                    page.waitForFileChooser(),
                    page.click('.inline-compose-buttons button[data-e2e-picker-button="ATTACHMENT"]')
                ])

                await page.screenshot({path: `./screenshots/${generateRandomString(8)}.png`});                            

                await fileChooser.accept([attachmentPath])

                // await delay(1000)  

                await page.screenshot({path: `./screenshots/${generateRandomString(8)}.png`});
              
            }

            await page.waitForSelector('.floating-button button[data-e2e-send-text-button]', {
                visible: true
            });

            await page.screenshot({path: `./screenshots/${generateRandomString(8)}.png`});

            await page.click('.floating-button button[data-e2e-send-text-button]');

            const conversationId = extractConversationId(page.url());
            

            enviarWebhook(webhook, 'messageSent', instanceName, {
                success: true,
                messageType,
                filaId,
                chatId: conversationId,
                phoneNumber,                
            })
 
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

async function consumeMessages(queueName) {
    try {
        const channel = global.instanceChannel
        await channel.assertQueue(`${queueName}_queue`, {
            durable: false,
            autoDelete: true
        });

        console.log(`Consumindo mensagens da fila ${queueName}...`);

        channel.prefetch(1);

        channel.consume(
            `${queueName}_queue`,
            async function (data) {
                if (data.content) { 
                    const { instanceName, phoneNumber, messageType, message, mediaURL, filaId } = JSON.parse(data.content.toString());                                    

                    try {                        
                        browserInstances[instanceName].enableAnswer = false   

                        if(messageType === 'attachment'){
                            const attachment = await saveImageFromUrl({ phoneNumber, mediaURL, instanceName })

                            if(attachment.error === true){
                                enviarWebhook(browserInstances[instanceName].webhook, 'messageSent', instanceName, {
                                    success: false,
                                    messageType,
                                    filaId,
                                    phoneNumber,                
                                })

                                channel.ack(data);

                                return
                            }

                            await sendMessage({ instanceName, phoneNumber, message, attachmentPath: attachment.path, messageType}, filaId)   

                            // await fs.unlink(attachment.path)
                        } else {
                            await sendMessage({ instanceName, phoneNumber, message }, filaId)   
                        }
                                                                     
                        channel.ack(data);
                    } catch (err) {
                        
                        channel.nack(data);
                    }

                    checarFila(channel, instanceName)
                    .then(data => {
                        if(data){
                            browserInstances[instanceName].enableAnswer = true
                            checkUnreadConversations(instanceName)
                        }
                    })                    
                    
                }
            }, {
                noAck: false,
                consumerTag: `consumer_${queueName}`
            }
        );
    } catch (error) {
        console.error('Erro ao consumir mensagens:', error);
    }
}

async function checarFila(channel, instanceName) {
    try {
        const queue = await new Promise((resolve) => {
            channel.checkQueue(`${instanceName}_queue`, (error, queue) => {
                if (error) {
                    resolve(0)
                }

                resolve(queue);
            });
        });

        if(queue){
            if(queue.messageCount > 0){
                return false
            } else {
                return true
            }
        } else {
            return true
        }
    } catch {
        return true
    }
} 

function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

async function saveImageFromUrl({ phoneNumber, mediaURL, instanceName }, directory = './uploads') {
    try {
        // Obtenha a extensão do arquivo a partir da URL
        const extension = path.extname(mediaURL);

        // Crie um nome de arquivo personalizado
        const randomString = generateRandomString(6);
        const fileName = `${instanceName}${phoneNumber}${randomString}${extension}`;

        // Crie o diretório se ele não existir
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }

        // Caminho completo para salvar a imagem
        const filePath = path.join(directory, fileName);

        // Faça o download da imagem
        const response = await axios({
            url: mediaURL,
            method: 'GET',
            responseType: 'stream',
            proxy: false
        });

        // Salve a imagem na pasta especificada
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve({
                error: false,
                path: filePath
            }));
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('Erro ao baixar a imagem:', error.message);
        return {
            error: true,
            message: "Failed to retrieve the file"
        }
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    checkUnreadConversations,
    extractConversationId,
    sendMessage,
    getRandomInt,
    consumeMessages
}