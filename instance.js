const fs = require('fs');
const { setTimeout } = require('timers');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

const { checkUnreadConversations, consumeMessages } = require('./message')
const { enviarWebhook } = require('./webhook')

puppeteer.use(StealthPlugin());
puppeteer.use(require('puppeteer-extra-plugin-session').default());

async function createBrowserInstance(instanceName, webhook) {
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox'
            ]
        });
        const page = await browser.newPage();

        await page.setViewport({ width: 1280, height: 720 });

        await page.goto('https://messages.google.com/web/authentication');
        setTimeout(() => {}, 5000)

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

async function desconectarInstancia(instanceName, sendWebhook = true){
    try{        
        if(browserInstances[instanceName]?.phoneConnected === true){
            const channel = global.instanceChannel
            await channel.cancel(`consumer_${instanceName}`)
        }        

        if (browserInstances[instanceName]) {
            if(sendWebhook){
                enviarWebhook(browserInstances[instanceName].webhook, 'phoneDisconnected', instanceName)
            }            
            await browserInstances[instanceName].browser.close()
            delete browserInstances[instanceName]
        }

        fs.rmSync(`./instances/${instanceName}.json`, { force: true })  
        
        console.log(`${instanceName} desconectada!`)

        return { 
            success: true,
            message: "Instância desconectada com sucesso"
        }
    } catch(e) {
        return {
            success: false,
            message: "Erro ao desconectar instância"
        }
    }
}
 
async function saveSessionData(page, instanceName, webhook) {
    try {
        const sessionData = await page.session.dump();
        sessionData.webhook = webhook
    
        fs.writeFileSync(`./instances/${instanceName}.json`, JSON.stringify(sessionData, null, 2));
    } catch (e) {
        
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
        

    }
}
 
// Função para carregar todos os arquivos JSON na pasta instances
async function loadAllInstances() {
    try {
        fs.readdir('./instances', async (err, files) => {
            if (err) {
                console.log(err)
                return
            }
            for (const file of files) {
                const instanceName = file.replace('.json', '');
                if (instanceName !== 'readme') {
                    console.log('Restaurando instância ', instanceName)
                    restoreSessionData(instanceName);
                }
            }
        })
    } catch (error) {
        console.error('Erro ao carregar as instâncias:', error);
    }
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

                    // Tomar medidas para lidar com a desconexão, como recarregar a página
                    await desconectarInstancia(instanceName)

                }
            } catch {

            }
        }
    })
}

async function waitForAuthentication(page, webhook, instanceName) {
    let Waiting = true    
    let countReconnection = 0    
    
    while (Waiting) {
        if(!browserInstances[instanceName]){
            Waiting = false
            break
        }

        console.log('Aguardando conexão...')
        countReconnection++

        if(countReconnection >= 100){
            Waiting = false
            await desconectarInstancia(instanceName, false)
        }

        // Espera até que o elemento com o seletor 'mws-conversations-list' apareça na página
        try {
            const response = await page.waitForSelector('mws-conversations-list', {
                timeout: 2000
            });

            if (response !== null) {
                Waiting = false

                enviarWebhook(webhook, 'phoneConnected', instanceName)                

                console.log(`Instância ${instanceName} conectada!`)

                browserInstances[instanceName].phoneConnected = true 
                browserInstances[instanceName].enableAnswer = true

                const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

                await delay(3000) 

                consumeMessages(instanceName)                 

                checkUnreadConversations(instanceName)

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

                console.log('Salvando as configurações...')
                saveSessionData(page, instanceName, webhook)
            } else {
          
            }
        } catch(e) {
            
        }
    }
}

module.exports = {
    createBrowserInstance,
    desconectarInstancia,
    saveSessionData,
    restoreSessionData,
    loadAllInstances,
    verificarDesconexao,
    waitForAuthentication
}