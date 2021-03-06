import { useMyReducer, useContractSuite, usePeer } from '../hooks'
import { useEffect } from 'react'
import { testAddress, testPreImage, LIGHTNING_SWAP_TYPE, chains } from '../utils'
import { decodeInvoice } from '../utils/lightning'
import {
  makerSigner,
  makerAdmin,
  takerSigner,
  takerAdmin,
  relayer
} from '../utils/demo-accounts'

export function useLightningSwapMaker () {
  const [state, { merge, set }] = useMyReducer()

  const peer = usePeer({ signer: makerSigner, host: true })

  const { metaSwap, provider } = useContractSuite({
    secret: relayer.privateKey,
    signer: makerSigner,
    owner: makerAdmin.address
  })

  const actions = {
    initialize ({ asset, amount, invoice }) {
      set({
        asset,
        amount,
        invoice,
        maker: metaSwap.depositAccount,
        ready: true
      })
      peer.connect()
    },
    async signSwap () {
      const { recipient, asset, amount } = state
      const signedSwap = await metaSwap.signSwap({ recipient, asset, amount })
      merge({ signedSwap })
      peer.send('signedSwap', signedSwap)
    }
  }

  peer.onConnect(() => {
    peer.send('swapType', LIGHTNING_SWAP_TYPE)
  })
  peer.onMessage('getSwapDetails', () => {
    const { maker, asset, amount, invoice: { invoice } } = state
    peer.send('swapDetails', { maker, asset, amount, invoice })
  })
  peer.onMessage('confirmRecipient', (recipient) => {
    merge({ recipient })
    // TODO move this to a button?
    actions.signSwap()
    // TODO listen on chain for published preImage, update hash if it exists
  })
  peer.onMessage('relayedTx', async (txHash) => {
    await provider.getTransaction(txHash)
    merge({ txHash })
  })

  return { ...state, ...actions, peer, provider, metaSwap }
}

export function useLightningSwapTaker ({ peer }) {
  const [state, { merge, set }] = useMyReducer()

  const { metaSwap, provider } = useContractSuite({
    secret: relayer.privateKey,
    signer: takerSigner,
    owner: takerAdmin.address
  })

  useEffect(() => {
    peer.send('getSwapDetails')
  }, [])

  peer.onMessage('swapDetails', (details) => {
    const chain = chains[details.asset.chain]
    if (!chain) {
      // show an error
      return
    }
    provider.setProvider(chain)
    // TODO parse and verify invoice
    const invoice = decodeInvoice(details.invoice)
    // todo set the chain
    // TODO check account owner and signer
    set({ ...details, invoice })
    // TODO this should be a button and input
    // actions.confirmRecipient()
  })
  peer.onMessage('signedSwap', (signedSwap) => {
    // TODO validate this!
    merge({ signedSwap })
    // actions.pubishPreImage()
  })
  const actions = {
    confirmRecipient ({ recipient = testAddress }) {
      merge({ recipient })
      peer.send('confirmRecipient', recipient)
    },
    async publishPreImage ({ preImage = testPreImage }) {
      const { signedSwap } = state
      const params = { ...signedSwap, preImage }
      metaSwap.validateParams(params)
      merge({ preImage })
      const { hash: txHash } = await metaSwap.relaySwap(params)
      merge({ txHash })
      peer.send('relayedTx', txHash)
    }
  }
  return { ...state, ...actions, peer, provider, metaSwap }
}
