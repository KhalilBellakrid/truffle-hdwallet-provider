const Ganache = require('ganache-core');
const assert = require('assert');
const LedgerWalletProvider = require('../ledger-wallet-provider/index.js');

const EthUtil = require('ethereumjs-util');

describe("Ledger Wallet Provider", function(done) {
  const Web3 = require('web3');
  const web3 = new Web3();
  const port = 8545;
  let server;
  let provider;

  before(done => {
    server = Ganache.server();
    server.listen(port, done);
  });

  after(done => {
    setTimeout(() => server.close(done), 100);
  });

  afterEach(() => {
    web3.setProvider(null);
    provider.engine.stop();
  });

  it('Get address from device', function(done){
    provider = new LedgerWalletProvider(`http://localhost:${port}`);
    web3.setProvider(provider);

    const addresses = provider.getAddresses()
    console.log(addresses);

    web3.eth.getBlockNumber((err, number) => {
      assert(number === 0);
      done();
    });
  });

});
