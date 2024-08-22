const axios = require('axios')


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

async function enviarWebhook(url, event, instanceName, data = null){
    try {
        if(!url){
            return false
        }
  
        const config = axiosConfig(
            "post",
            url, 
            {
                "Content-Type": "application/json",
            }, 
            JSON.stringify({
                event: event,
                instanceName: instanceName,
                ...data
            })
        ); 

        await axios(config);

        return true;
    } catch(e) {
        
        return false
    }
}

module.exports = {
    axiosConfig,
    enviarWebhook
}