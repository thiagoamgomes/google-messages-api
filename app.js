const express = require('express');
const amqp = require('amqplib/callback_api')
const QRCode = require('qrcode');
const app = express();
const port = 4000;

const fs = require('fs');

const { createBrowserInstance,desconectarInstancia,loadAllInstances,verificarDesconexao,waitForAuthentication } = require('./instance')
const { getRandomInt } = require('./message')

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

global.browserInstances = {}
 
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
            await desconectarInstancia(instanceName, false)            
        }

        await createBrowserInstance(instanceName, webhook);

        await browserInstances[instanceName].page.waitForSelector('[data-qr-code]', {
            timeout: 20000
        });

        const qrCodeUrl = await browserInstances[instanceName].page.$eval('[data-qr-code]', qrCodeElement => qrCodeElement.getAttribute('data-qr-code'));

        // console.log(`Instância '${instanceName}' criada. URL do QR Code:`, qrCodeUrl);
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
    const queueName = instanceName;
    const channel = global.instanceChannel
    await channel.assertQueue(`${queueName}_queue`, {
        durable: false,
        autoDelete: true
    });
    await channel.sendToQueue(`${queueName}_queue`, Buffer.from(JSON.stringify({
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

app.delete('/delete-instance/:instanceName', async (req, res) => {
    try {
        const {
            instanceName
        } = req.params;

        res.send(await desconectarInstancia(instanceName))
    } catch {
        res.status(500).send({
            success: false,
            error: `Erro ao desconectar instância`
        })
    }
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});

loadAllInstances()

// Rotina para verificar a desconexão a cada 5 segundos
setInterval(() => {
    verificarDesconexao();
}, 5000);



