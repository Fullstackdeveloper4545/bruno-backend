const ifthenpay = require('./providers/ifthenpayProvider');
const klarna = require('./providers/klarnaProvider');

function getProvider(provider) {
  if (provider === 'ifthenpay') return ifthenpay;
  if (provider === 'klarna') return klarna;
  throw new Error(`Unsupported payment provider: ${provider}`);
}

module.exports = { getProvider };
