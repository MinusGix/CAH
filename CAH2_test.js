let CAH = require('./CAH2.js');

let col1 = CAH.CardCollection.create({
	name: "Testing-1",
	black: [
		["Santa, looking down at the ", 0, ", laughed in his jolly voice \"", 1, "\"!"],
		["The drugee snatched the ", 0, ", grinning wildy, as he stuffed it into his ", 1, "."]
	],
	white: [
		"Christmas",
		"Flashlight",
		"Purse",
		"Oreo",
		"Communism For All"
	]
})

let P1 = new CAH.Player('Player1');
let P2 = new CAH.Player('Player2');
let P3 = new CAH.Player('Player3');

let game = CAH.Game.create(P1);
game.cards.merge(col1);

game.addPlayer(P2);
game.addPlayer(P3);

game.start();

console.log(game.toString());

game.removePlayer(P2);

console.log(game.toString());

let P4 = new CAH.Player('Player4');

game.addPlayer(P4);
game.start();

console.log(game.toString());

console.log(game.blackCard.toString());

game.players.forEach(player => {
	if (!game.isTsar(player)) {
		for (let i = 0; i < game.blackCard.getFillCount(); i++) {
			game.play(player, player.cards[i]);
		}
		console.log(player.id, "played cards.");
	} else {
		console.log(player.id, "is tsar");
	}
});


console.log(game.state);
console.log(game.getFilledInCardText());

let chosen = CAH.randomIndex(game.getFilledInCardText().length);

game.chooseWinnerByIndex(game.tsar, chosen);