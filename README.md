# SeuFuturo

Calculadora de juros compostos com inflação e aportes crescentes, em português e com valores em reais.

## Como usar

Baixe o projeto e abra o arquivo [`index.html`](index.html) no navegador. Não é necessário instalar dependências, configurar um servidor ou ter conexão com a internet para fazer as simulações.

1. Informe o valor inicial, o aporte mensal e o aumento anual dos aportes.
2. Ajuste o rendimento estimado, o prazo e a inflação.
3. Nas opções avançadas, configure a meta, o momento do depósito e a comparação com começar depois.
4. Consulte os resultados e gráficos, ou clique em **Exportar mês a mês** para baixar os dados em CSV.

## Recursos

- Aportes com aumento anual percentual ou acréscimo fixo em reais, a partir do 13º mês.
- Rendimento mensal ou anual, com conversão entre taxas efetivas.
- Saldo nominal, total depositado, rendimentos e poder de compra após a inflação.
- Comparação entre aportes constantes e crescentes e entre começar agora ou depois.
- Meta em valor nominal ou em poder de compra de hoje.
- Gráficos interativos, tabela anual e exportação mensal em CSV.
- Layout adaptado a computadores e celulares.

## Estrutura

O arquivo `index.html` reúne toda a página, os estilos e os cálculos. A calculadora funciona inteiramente no navegador, sem serviços externos ou bibliotecas adicionais.

## Hipóteses da simulação

Os resultados consideram as taxas constantes informadas, o reinvestimento dos juros e o reajuste anual escolhido para os aportes. Não incluem impostos, tarifas ou outros custos. A inflação não é adicionada automaticamente ao reajuste dos aportes. Os valores são simulações educativas, não garantias de rentabilidade.

A metodologia e os links de referência estão disponíveis na própria calculadora.
