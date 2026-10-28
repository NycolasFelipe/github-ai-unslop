# GitHub AI Unslop

Extensão para Firefox que remove o Copilot da interface do GitHub: o botão do
cabeçalho, o painel de chat, a caixa "Ask Copilot" do dashboard, links para
`/copilot`, opções como "Assign to Copilot" e elementos `<copilot-*>`.

As páginas de configuração (`/settings/copilot`) continuam acessíveis, para que
você ainda consiga desligar recursos do Copilot na conta.

## Como funciona

`content.js` roda em `github.com` e `gist.github.com` desde o início do
carregamento e faz duas coisas:

1. Injeta uma folha de estilo que esconde elementos com marcadores estáveis do
   Copilot (`partial-name`, `data-testid`, `aria-label`, links para
   `/copilot` etc.).
2. Observa o DOM com um `MutationObserver` e esconde botões e itens de menu
   cujo texto menciona "Copilot", ignorando conteúdo escrito por usuários
   (markdown, comentários, código).

O GitHub muda a interface com frequência. Quando algo novo do Copilot
aparecer, adicione o seletor na lista `SELECTORS` em `content.js`.

## Instalar para testar

1. Abra `about:debugging#/runtime/this-firefox`.
2. Clique em **Carregar extensão temporária** e escolha o `manifest.json`.

Ou, com o [web-ext](https://github.com/mozilla/web-ext):

```sh
npx web-ext run
```

## Empacotar

```sh
npx web-ext build
```

Para instalar de forma permanente no Firefox normal, a extensão precisa ser
assinada pela Mozilla (`npx web-ext sign`, com credenciais do AMO). No Firefox
Developer Edition ou Nightly dá para desativar `xpinstall.signatures.required`
em `about:config` e instalar o `.zip` gerado.

## Ligar e desligar

Clique no ícone da extensão e use a caixa de seleção. A mudança vale na hora
para todas as abas.
