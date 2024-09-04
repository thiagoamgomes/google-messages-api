# Google Messages RCS Wrapper API

Esta API fornece uma interface para enviar mensagens RCS pelo celular usando o aplicativo Google Messages. A configuração é simplificada com Docker, permitindo a fácil execução e uso da API.

## Sumário

- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Uso](#uso)
- [Endpoints](#endpoints)
- [Contribuindo](#contribuindo)
- [Licença](#licença)

## Requisitos

- [Docker](https://www.docker.com/)
- [Git](https://git-scm.com/)

## Instalação

1. Clone este repositório:
   ```bash
   git clone [https://github.com/seu-usuario/nome-do-repositorio.git](https://github.com/thiagoamgomes/sms-google.git)
   cd sms-google
   ```

2. Execute o Docker Compose:
   ```bash
   docker compose up -d --build
   ```

3. A API estará disponível em `http://localhost:4000`, onde `4000` é a porta especificada no `docker-compose.yml`.

## Configuração

Este repositório inclui um arquivo `docker-compose.yml` para configuração simplificada. Certifique-se de verificar e ajustar as variáveis de ambiente conforme necessário.

## Uso

Você pode testar e interagir com a API utilizando o Postman. O arquivo `sms-google-collection.json` incluído no repositório contém todos os endpoints configurados para você começar.

### Importando a Collection no Postman

1. Abra o Postman.
2. Importe o arquivo `sms-google-collection.json`:
   - Clique em **Import** no canto superior esquerdo.
   - Selecione o arquivo `sms-google-collection.json` localizado neste repositório.
3. A coleção será importada, permitindo que você veja e utilize todos os endpoints disponíveis.

## Endpoints

A coleção do Postman inclui os seguintes endpoints principais:

- **create-instance:** Para criar uma nova instância com o nome desejado.
- **delete-instance:** Exclui a instância.
- **send-message:** Enviar uma mensagem dos tipos text e attachment. No tipo attachment pode ser enviado arquivos como imagem, video, documento, etc.

Confira o arquivo `sms-google-collection.json` para mais detalhes sobre os parâmetros de cada endpoint.

## Contribuindo

Contribuições são bem-vindas! Se você tiver sugestões, abra uma issue ou faça um pull request.

## Licença

Este projeto está licenciado sob a [Licença MIT](LICENSE).
