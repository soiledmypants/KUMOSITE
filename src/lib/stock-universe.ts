// Supported Robinhood Chain tokenized stocks. This is the single source of
// truth for the "kumo thinking" panel. Real price feeds / scanners can later
// replace the mock scoring in mock-scan.ts — this list stays as-is.

export type SupportedStock = {
  name: string;
  symbol: string;
  contract: `0x${string}`;
};

export type StockStatus = "leading" | "watching" | "rising" | "cooling" | "rejected";

export type MockStockAnalysis = SupportedStock & {
  score: number; // 0-100
  momentum: number; // 0-100
  volume: number; // 0-100
  volatility: number; // 0-100
  liquidity: number; // 0-100
  status: StockStatus;
};

export const SUPPORTED_STOCKS: SupportedStock[] = [
  { symbol: "AAOI", name: "Applied Optoelectronics", contract: "0x521Cf887E6531c6F667b5BC4D896E5d9bfE8EB2E" },
  { symbol: "AAPL", name: "Apple", contract: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
  { symbol: "AMAT", name: "Applied Materials", contract: "0x36046893810a7E7fCE501229d57dc3FC8c8716d0" },
  { symbol: "AMD", name: "AMD", contract: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC" },
  { symbol: "AMZN", name: "Amazon", contract: "0x12f190a9F9d7D37a250758b26824B97CE941bF54" },
  { symbol: "APLD", name: "Applied Digital", contract: "0xb8DBf92F9741c9ac1c32115E78581f23509916FD" },
  { symbol: "ASML", name: "ASML Holding NV", contract: "0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA" },
  { symbol: "ASTS", name: "AST SpaceMobile", contract: "0x1AF6446f07eb1d97c546AFC8c9544cBDF3AD5137" },
  { symbol: "AVGO", name: "Broadcom", contract: "0x156E175DD063a8cE274C50654eF40e0032b3fbcF" },
  { symbol: "BA", name: "Boeing", contract: "0x4D21483a44Bf67a86b77E3dA301411880797D452" },
  { symbol: "BABA", name: "Alibaba", contract: "0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4" },
  { symbol: "BE", name: "Bloom Energy", contract: "0x822CC93fFD030293E9842c30BBD678F530701867" },
  { symbol: "CBRS", name: "Cerebras Systems", contract: "0x5c90450Bbb4273D7b2f17CF6917AEB237A569679" },
  { symbol: "CCL", name: "Carnival Corporation", contract: "0x9651342CeA770aE9a2969Ba2A52611523146aef9" },
  { symbol: "CELH", name: "Celsius", contract: "0x8cF07C5A878945185d327aAa6e33FAa95F95e7bF" },
  { symbol: "CLSK", name: "CleanSpark", contract: "0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3" },
  { symbol: "COIN", name: "Coinbase", contract: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b" },
  { symbol: "COST", name: "Costco", contract: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2" },
  { symbol: "CRCL", name: "Circle Internet Group", contract: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5" },
  { symbol: "CRWD", name: "CrowdStrike Holdings", contract: "0xea72Ecca2d0f6bFA1394DBBCff85b52CD4233931" },
  { symbol: "CRWV", name: "CoreWeave", contract: "0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3" },
  { symbol: "DDOG", name: "Datadog", contract: "0x27c99fBde9D0d2AA4f4Bfb4943f237843DdF6958" },
  { symbol: "DELL", name: "Dell", contract: "0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd" },
  { symbol: "ELF", name: "e.l.f. Beauty", contract: "0x39EC44Bee4F6A116c6F9B8De566848a985C53C60" },
  { symbol: "EWY", name: "iShares MSCI South Korea fund", contract: "0x7f0aBeF0C07280F82c6a08ead09dEd6BAE2C13Fc" },
  { symbol: "F", name: "Ford Motor", contract: "0x25C288E6D899b9BC30160965aD9644c67e73bE0C" },
  { symbol: "FLNC", name: "Fluence Energy", contract: "0x282e87451E10fA6679BC7D76C69BE44cD3fC777C" },
  { symbol: "FUTU", name: "Futu Holdings", contract: "0xeB30663bDFf0622Ef4e4E5cBb4E975F19f33f51D" },
  { symbol: "GLW", name: "Corning", contract: "0x7c04E6A3368F2A1DE3874f0e80d2e0A1a9915da6" },
  { symbol: "GME", name: "GameStop", contract: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E" },
  { symbol: "GOOGL", name: "Alphabet Class A", contract: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
  { symbol: "INOD", name: "Innodata", contract: "0xf1953DAB6FaD537488d5A022361FfAa8B4c95eC6" },
  { symbol: "INTC", name: "Intel", contract: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681" },
  { symbol: "INTU", name: "Intuit", contract: "0x56d23beE5f41A7120170b0c603Dae30128e460e9" },
  { symbol: "IONQ", name: "IonQ", contract: "0x558378E000D634A36593E338eBacdd6207640EfE" },
  { symbol: "IREN", name: "IREN Limited", contract: "0xF0AB0c93bE6F41369d302e55db1A96b3c430212D" },
  { symbol: "LITE", name: "Lumentum", contract: "0x8eF20885F94e3D9bc7eB3080279188Bd5ED7c08C" },
  { symbol: "LLY", name: "Eli Lilly", contract: "0x8005d266423c7ea827372c9c864491e5786600ea" },
  { symbol: "LULU", name: "Lululemon", contract: "0x4e62068525Ab11FE768e29dfD00ef909B9803016" },
  { symbol: "LUNR", name: "Intuitive Machines", contract: "0xa5D4968421bA94814Be3B136b15cf422101aC1a3" },
  { symbol: "MDB", name: "MongoDB", contract: "0xDdf2266b79abf0B48898959B0ed6E6adf512be74" },
  { symbol: "META", name: "Meta Platforms", contract: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35" },
  { symbol: "MRVL", name: "Marvell Technology", contract: "0x62fd0668e10D8B72339BE2DCF7643001688ff13B" },
  { symbol: "MSFT", name: "Microsoft", contract: "0xe93237C50D904957Cf27E7B1133b510C669c2e74" },
  { symbol: "MSTR", name: "Strategy Inc.", contract: "0xec262a75e413fAfD0dF80480274532C79D42da09" },
  { symbol: "MU", name: "Micron Technology", contract: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD" },
  { symbol: "MXL", name: "MaxLinear", contract: "0x48961813349333209994750ffA89b3c5C22eC969" },
  { symbol: "NBIS", name: "Nebius Group", contract: "0x9D9c6684F596F66a64C030B93A886D51Fd4D7931" },
  { symbol: "NFLX", name: "Netflix", contract: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8" },
  { symbol: "NNE", name: "Nano Nuclear Energy", contract: "0xBEF75684C43c4ea7BD18Dd532a2244674Ee8b926" },
  { symbol: "NOW", name: "ServiceNow", contract: "0x0C3260aF4B8f13a69c4c2dFb84fD667890CDFa14" },
  { symbol: "NU", name: "Nu", contract: "0x408c14038a04f7bD235329E26d2bf569ee20e250" },
  { symbol: "NVDA", name: "NVIDIA", contract: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { symbol: "NVTS", name: "Navitas Semiconductor", contract: "0xbE6702d7b70315376dC48a3293f24f0982F86386" },
  { symbol: "ORCL", name: "Oracle", contract: "0xb0992820E760d836549ba69BC7598b4af75dEE03" },
  { symbol: "P", name: "Everpure", contract: "0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D" },
  { symbol: "PENG", name: "Penguin Solutions", contract: "0x9b23573b156B52565012F5cE02CDF60AFBaa70Be" },
  { symbol: "PLTR", name: "Palantir Technologies", contract: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A" },
  { symbol: "POET", name: "POET Technologies", contract: "0xcf6B2D875361be807EAfa57458c80f28521F9333" },
  { symbol: "PR", name: "Permian Resources", contract: "0x4189F0c66EBBB0bfeF1C31f763131361EF32f77C" },
  { symbol: "QBTS", name: "D-Wave Quantum", contract: "0xC583c60aeF9Dc401Da72cEC1B404743a93cea1Cc" },
  { symbol: "QCOM", name: "Qualcomm", contract: "0x0f17206447090e464C277571124dD2688E48AEA9" },
  { symbol: "QQQ", name: "Invesco QQQ", contract: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68" },
  { symbol: "QUBT", name: "Quantum Computing", contract: "0x59818904ab4cE163b3cE4FfB64f2D6Ca02c434B4" },
  { symbol: "RBLX", name: "Roblox", contract: "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8" },
  { symbol: "RDDT", name: "Reddit", contract: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C" },
  { symbol: "RDW", name: "Redwire", contract: "0x92Ef19E82bD8fF36661DE838D5eaE7e5CEF0EfFE" },
  { symbol: "RGTI", name: "Rigetti Computing", contract: "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba" },
  { symbol: "RIVN", name: "Rivian Automotive", contract: "0xB1BF26c1D20ff267A4f93550d1E0d06ac40a114B" },
  { symbol: "RKLB", name: "Rocket Lab Corporation", contract: "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2" },
  { symbol: "SATS", name: "EchoStar", contract: "0x95052ddcd5DC25641657424A8Cf04834997E1730" },
  { symbol: "SGOV", name: "iShares 0-3 Month Treasury Bond", contract: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5" },
  { symbol: "SHOP", name: "Shopify", contract: "0xF53F66751B1Eff985311b693531E3290F600c410" },
  { symbol: "SKHY", name: "SK hynix ADS", contract: "0x84CAb63bc87912E71ad199ff14A0bA45de68FeF8" },
  { symbol: "SLV", name: "iShares Silver Trust", contract: "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f" },
  { symbol: "SMCI", name: "Super Micro Computer", contract: "0xc01aA1fECeC0605b13bc84874ff7256C0f5F562a" },
  { symbol: "SNDK", name: "Sandisk Corporation", contract: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400" },
  { symbol: "SOFI", name: "SoFi Technologies", contract: "0x98E75885157C80992A8D41b696D8c9C6Fb30A926" },
  { symbol: "SOXX", name: "iShares Semiconductor ETF", contract: "0x75742c18BC1f1C5c5f448f4C9D9C6F66dafAAa38" },
  { symbol: "SPCX", name: "SpaceX Class A", contract: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa" },
  { symbol: "SPMO", name: "Invesco S&P 500 Momentum ETF", contract: "0xAd622320e520de39e72d41EF07438C3Fd3354875" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", contract: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" },
  { symbol: "TSEM", name: "Tower Semiconductor", contract: "0x89776d4Cd68193597A2fC132cfaC1fDe36CCeA8a" },
  { symbol: "TSLA", name: "Tesla", contract: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing", contract: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA" },
  { symbol: "TTWO", name: "Take-Two Interactive Software", contract: "0x5e81213613b6B86EaB4c6c50d718d34359459786" },
  { symbol: "UMC", name: "United Microelectronics", contract: "0x0E6e67Ba88e7b5d9B67636A215c76779B948dE79" },
  { symbol: "UPS", name: "UPS", contract: "0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2" },
  { symbol: "USAR", name: "USA Rare Earth", contract: "0xd917B029C761D264c6A312BBbcDA868658eF86a6" },
  { symbol: "USO", name: "United States Oil Fund", contract: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344" },
  { symbol: "WDAY", name: "Workday", contract: "0x82DA4646242e1D962e96e932269Dc644c94a9CaA" },
  { symbol: "XLK", name: "State Street Technology Select Sector SPDR ETF", contract: "0x15Cd20759CE7F3285c29A319dE2D1A2e098c6f43" },
  { symbol: "XNDU", name: "Xanadu Quantum", contract: "0xA8eB3BCcbf2017eE7CBfb652eB51CF2E1B153289" },
  { symbol: "XOM", name: "ExxonMobil", contract: "0xf9B46d3D1B22199D4D1025a9cEDB540A33F1a2d5" },
  { symbol: "ZM", name: "Zoom", contract: "0x44c4F142009036cF477eD2d09932051843137CF1" },
  { symbol: "ZS", name: "Zscaler", contract: "0x7dc013eB55e436f30d7ED1AFE4E36d6e45e3c3f7" },
];

/** The symbol kumo starts the simulated scan already favoring. */
export const INITIAL_LEADER = "MSFT";
