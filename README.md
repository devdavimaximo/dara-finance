# dara — organizador financeiro

Contas a pagar e a receber, recorrências, parcelas, comprovantes e um painel com caixa realizado e projetado.
Multi-tenant: cada **espaço** (ex.: *Metup* e *Pessoal*) tem lançamentos, categorias, pessoas e relatórios
totalmente separados. Instala no celular como app (PWA), **funciona offline**, avisa vencimentos por push
e importa extrato bancário (OFX/CSV) com conciliação.

**Stack:** ASP.NET Core 10 (minimal API) + EF Core/SQLite · React 19 + Vite + Tailwind 4 + Recharts + TanStack Query · um container.

## Rodar local

```bash
# terminal 1 — API em http://localhost:5180 (banco em Finances.Server/.data/)
cd Finances.Server && dotnet run

# terminal 2 — front em http://localhost:5173 (proxy /api → 5180)
cd web && npm install && npm run dev
```

No primeiro acesso aparece a tela de **Primeiro acesso**: cria o administrador e o primeiro espaço.
Os outros espaços (ex.: Pessoal) você cria em **Ajustes → Novo espaço**.

> Offline e push dependem do service worker, que só existe no build de produção:
> `cd web && npm run build && npx vite preview` (porta 4173, com proxy para a API).

**Testes:** `dotnet test` — ponta a ponta da API (HTTP real, banco novo por teste: login, isolamento entre
espaços, recorrência, pagamento/caixa, idempotência offline, importação/conciliação, push, CSV) + parser de
extrato, resumo de avisos e recorrência. `cd web && npm test` — motor do painel.

## Deploy na VPS

Pré-requisitos: Docker + Docker Compose na VPS e um domínio (ou subdomínio) apontando para o IP dela.

```bash
git clone … finances && cd finances
cp .env.example .env      # ajuste DOMAIN e VAPID_SUBJECT
docker compose up -d --build
```

- O **Caddy** emite o HTTPS sozinho (Let's Encrypt). Sem HTTPS o celular não instala, não funciona offline
  e não recebe avisos.
- Tudo que importa fica no volume `razao-data` (`/data`): `finances.db`, `uploads/` (comprovantes), `keys/`
  (cookie de login) e `vapid.json` (chaves do push — se perder, cada aparelho precisa reativar os avisos).
- **Backup:** `chmod +x backup.sh` e agende no cron: `0 3 * * * /caminho/finances/backup.sh`.
  Ele para o app por alguns segundos, compacta o volume em `backups/` e mantém 30 dias.
- Atualizar: `git pull && docker compose up -d --build` (as migrações rodam sozinhas no start).

### Instalar no celular

Abra o domínio no navegador do celular → **Adicionar à tela inicial** (Safari: compartilhar → Adicionar à
Tela de Início; Chrome: menu → Instalar app). Depois, em **Ajustes → Avisos de vencimento**, ligue
"Receber neste aparelho" (no iPhone, só pelo app instalado, iOS 16.4+).

## Potes e objetivos

- **Potes** são as categorias do app (Contas, Lazer, Mercado…). Crie quantos quiser em *Potes*; pote de despesa
  pode ter **teto mensal** — a tela mostra quanto já saiu de cada um no mês, quanto resta e quais estouraram.
- **Objetivos** (casamento, carro, casa, viagem): uma meta em reais, com data opcional. Toda despesa — avulsa,
  recorrente ou parcelada — pode ser ligada a um objetivo. Ele mostra **pago**, **agendado** (parcelas futuras),
  **sem conta lançada** (o resto da meta), quanto **falta pagar** e **quanto por mês** até a data, com a curva
  acumulada. Os totais consideram todo o histórico, não só a janela do painel.
- Pote e objetivo são independentes: a parcela do buffet pode estar no pote "Festa" e no objetivo "Casamento".
- Excluir um objetivo não apaga lançamentos — eles só deixam de contar para ele.

## Offline

- Cada espaço guarda no aparelho (IndexedDB) **24 meses para trás e 13 para frente**: painel, lançamentos e
  relatórios abrem instantâneo e funcionam sem rede.
- **Criar, editar, pagar e excluir** funcionam offline: a tela atualiza na hora e a alteração entra numa fila
  (persistida — sobrevive a fechar o app). Quando a conexão volta, a fila é enviada em ordem.
  Lançamentos novos nascem com o id definitivo, então reenviar nunca duplica.
- Precisam de conexão: comprovante, importação de extrato, ajustes, e períodos fora da janela local.
- Se o servidor recusar uma alteração (ex.: validação), ela é desfeita na tela e uma faixa avisa.
- Ao sair da conta, tudo que estava no aparelho é apagado.

## Avisos de vencimento

Um resumo por dia, no horário escolhido (padrão 8h), com o que vence hoje / nos próximos N dias e o que está
atrasado — de todos os espaços do usuário. Web Push padrão (VAPID), sem serviço externo pago.
"Enviar teste agora" em Ajustes manda o resumo na hora.

## Importar extrato

Lançamentos → **Importar extrato**. Aceita OFX (todos os bancos) e CSV (Nubank, Inter, Itaú etc. — as colunas
são detectadas pelo cabeçalho ou pelo conteúdo). Na revisão:
- **Conciliação:** se a transação bate com uma conta em aberto (mesmo tipo, valor até 2% e vencimento entre
  45 dias antes e 7 depois), ela marca essa conta como paga em vez de criar outra.
- **Categoria sugerida** pelo histórico (descrições parecidas já categorizadas).
- **Nunca duplica:** cada transação guarda o id do extrato; reenviar o mesmo arquivo é seguro.
- Fatura de cartão em CSV costuma trazer gastos positivos: use "É fatura de cartão" / "Inverter sinais".

## Contas, acesso e separação

- **Tudo exige login** (e-mail + senha com hash; cookie httpOnly de 30 dias; 8 tentativas/min por IP).
  Não existe cadastro aberto: a tela de primeiro acesso cria o admin uma única vez e se fecha.
- **Só o admin cria contas** (Ajustes → Usuários), com **senha provisória**. No primeiro login a pessoa é
  obrigada a criar a própria senha — até lá a API recusa qualquer outra coisa. O admin nunca fica sabendo a
  senha definitiva.
- **Esqueceu a senha:** o admin gera uma provisória nova. **Desativar** bloqueia o login. Nos dois casos as
  sessões abertas da pessoa caem na hora (carimbo de segurança no cookie). Os dados ficam.
- **Espaços ilimitados.** Quem pode criar: o admin e quem tiver "pode criar espaços". Quem cria vira o único
  responsável — ninguém mais vê, nem o admin. O admin também pode criar um espaço já em nome de outra pessoa,
  sem entrar nele.
- **Espaço = tenant.** Toda tabela de negócio tem `WorkspaceId`; o `WorkspaceFilter` confere a membership em
  toda rota `/api/w/{id}/…` e o `AppDb` aplica filtro global + carimba o tenant em cada escrita.
  Quem não é membro recebe 404. Na lista de usuários o admin vê só quantos espaços cada um tem.
- **Papéis no espaço:** *Responsável* (edita o espaço, dá acesso a contas existentes, muda papéis, remove
  pessoas) e *Membro* (lança e vê relatórios). Qualquer um pode sair de um espaço. Todo espaço mantém ao
  menos um responsável — o último não sai nem se rebaixa sem promover outra pessoa antes.

Exemplo — sócio com finanças pessoais privadas: admin cria a conta dele com "pode criar espaços" e acesso de
responsável na Metup → ele entra, cria a própria senha e cria o "Pessoal" dele → só ele vê esse espaço.
