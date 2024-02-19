const { setTimeout } = require('timers');

const { enviarWebhook } = require('./webhook')

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

async function sendMessage(instanceName, phoneNumber, message, filaId) {
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

            // const [ fileChooser ] = await Promise.all([
            //     page.waitForFileChooser(),
            //     page.click('.inline-compose-buttons button[data-e2e-picker-button="ATTACHMENT"]')
            // ])

            // await fileChooser.accept(['C:\Users\thiag\Documents\novos_projetos\google-messages\imagem.png'])

            await page.type('textarea[data-e2e-message-input-box]', message);

            await page.waitForSelector('.floating-button button[data-e2e-send-text-button]', {
                visible: true
            });

            await page.click('.floating-button button[data-e2e-send-text-button]');

            const conversationId = extractConversationId(page.url());
            

            enviarWebhook(webhook, 'messageSent', instanceName, {
                success: true,
                filaId,
                chatId: conversationId,
                phoneNumber
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
                    const json = JSON.parse(data.content.toString());                                    

                    try {                        
                        browserInstances[json.instanceName].enableAnswer = false   
                        await sendMessage(json.instanceName, json.phoneNumber, json.message, json.filaId)                        
                        channel.ack(data);
                    } catch (err) {
                        
                        channel.nack(data);
                    }

                    checarFila(channel, json.instanceName)
                    .then(data => {
                        if(data){
                            browserInstances[json.instanceName].enableAnswer = true
                            checkUnreadConversations(json.instanceName)
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

module.exports = {
    checkUnreadConversations,
    extractConversationId,
    sendMessage,
    getRandomInt,
    consumeMessages
}