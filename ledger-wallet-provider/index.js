const debug = require('debug')('truffle-hdwallet-provider')
const ProviderEngine = require("web3-provider-engine");
const FiltersSubprovider = require('web3-provider-engine/subproviders/filters.js');
const NonceSubProvider = require('web3-provider-engine/subproviders/nonce-tracker.js');
const HookedSubprovider = require('web3-provider-engine/subproviders/hooked-wallet.js');
const ProviderSubprovider = require("web3-provider-engine/subproviders/provider.js");
const Web3 = require("web3");
const Transaction = require('ethereumjs-tx');
const ethUtil = require('ethereumjs-util');
const Eth = require('@ledgerhq/hw-app-eth').default
const eip55 = require('eip55')
const CommNodeHid = require('@ledgerhq/hw-transport-node-hid').default

function getDevice() {
  return new Promise((resolve, reject) => {
    const sub = CommNodeHid.listen({
      error: err => {
        sub.unsubscribe()
        reject(err)
      },
      next: async e => {
        if (!e.device) {
          return
        }
        if (e.type === 'add') {
          sub.unsubscribe()
          resolve(e.device)
        }
      },
    })
  })
}

let queue = Promise.resolve()

let busy = false
CommNodeHid.setListenDevicesPollingSkip(() => busy)

function WithDevice(devicePath) {
  return job => {
    const p = queue.then(async () => {
      busy = true
      try {
        const t = await CommNodeHid.open(devicePath)
        t.setDebugMode(message => {
          console.log(`APDU : ${message}`);
        })

        const res = await job(t).catch(e => console.log(`Device error: ${e.message}`))
        return res
      } finally {
        busy = false
      }
    })

    queue = p.catch(error => {
      console.log(`Queue error: ${error}`);
    })

    return p
  }
}

const singletonNonceSubProvider = new NonceSubProvider();

function LedgerWalletProvider(
  provider,
  address_index=0,
  num_addresses=2,
  shareNonce=true,
  wallet_hdpath="44'/60'/0'/0/",
  verify=false
) {

  this.wallets = {};
  this.addresses = [];

  let tmp_accounts = this.addresses;
  let tmp_wallets = this.wallets;
  getDevice().then(device => {
    this.device = device;
    WithDevice(device.path)(async transport => {
        const eth = new Eth(transport);
        const getAddressAtIndex = i => {
          const path = `${wallet_hdpath}${i}`
          return eth.getAddress(path).then(r => {
            const address = eip55.encode(r.address);
            this.addresses.push(address);
            this.wallets[address] = path;
            if (i == num_addresses) {
              tmp_accounts = this.addresses;
              tmp_wallets = this.wallets;
              console.log(`Got addresses: ${tmp_accounts}`);
              console.log(`Got wallets: `,tmp_wallets);
              transport.close()
              return
            }
            getAddressAtIndex(i + 1)
          }).catch(e => console.log(`>>> Catch error when getting address ${i}: ${e}`))
        }
        getAddressAtIndex(0)
        .catch(e => console.log(`>>> Catch error when getting addresses: ${e}`))
    })
  })

  this.engine = new ProviderEngine();
  this.engine.addProvider(new HookedSubprovider({
    getAccounts: function(cb) { cb(null, tmp_accounts) },
    getPrivateKey: function(address, cb) {
      if (!tmp_wallets[address]) { return cb('Account not found'); }
      else { cb(null, tmp_wallets[address].getPrivateKey().toString('hex')); }
    },
    signTransaction: function(txParams, cb) {

      const from = txParams.from.toLowerCase()
      if (tmp_wallets.length == 0) { cb('No account found'); }
      const tx = new Transaction(txParams);
      const eth = new Eth(this.device.path);
      eth.signTransaction(this.wallets[from], tx.serialize().toString('hex')).then(result => {
        tx.v = Buffer.from(result.v, 'hex')
        tx.r = Buffer.from(result.r, 'hex')
        tx.s = Buffer.from(result.s, 'hex')

        const rawTx = '0x' + tx.serialize().toString('hex');
        cb(null, rawTx);
      })
    },
    signMessage: function(message, cb) {
      throw new Error("signMessage is not supported in ledger-wallet-provider")
      /*
      const dataIfExists = message.data;
      if (!dataIfExists) {
        cb('No data to sign');
      }
      if (!tmp_wallets[message.from]) {
        cb('Account not found');
      }
      const wallet_path = tmp_wallets[message.from];
      const dataBuff = ethUtil.toBuffer(dataIfExists);
      const msgHashBuff = ethUtil.hashPersonalMessage(dataBuff);
      const sig = ethUtil.ecsign(msgHashBuff, pkey);
      const rpcSig = ethUtil.toRpcSig(sig.v, sig.r, sig.s);
      cb(null, rpcSig);
      */
      }
  }));

  (!shareNonce)
    ? this.engine.addProvider(new NonceSubProvider())
    : this.engine.addProvider(singletonNonceSubProvider);

  this.engine.addProvider(new FiltersSubprovider());
  if (typeof provider === 'string') {
    this.engine.addProvider(new ProviderSubprovider(new Web3.providers.HttpProvider(provider)));
  } else {
    this.engine.addProvider(new ProviderSubprovider(provider));
  }
  this.engine.start(); // Required by the provider engine.

};

LedgerWalletProvider.prototype.sendAsync = function() {
  this.engine.sendAsync.apply(this.engine, arguments);
};

LedgerWalletProvider.prototype.send = function() {
  return this.engine.send.apply(this.engine, arguments);
};

// returns the address of the given address_index, first checking the cache
LedgerWalletProvider.prototype.getAddress = function(idx) {
  debug('getting addresses', this.addresses[0], idx)
  if (!idx) { return this.addresses[0]; }
  else { return this.addresses[idx]; }
}

// returns the addresses cache
LedgerWalletProvider.prototype.getAddresses = function() {
  return this.addresses;
}

module.exports = LedgerWalletProvider;
