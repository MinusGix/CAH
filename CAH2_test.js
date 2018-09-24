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
});

let P1 = new CAH.Player('Player1');
let P2 = new CAH.Player('Player2');
let P3 = new CAH.Player('Player3');

let game = CAH.Game.create(P1);
game.cards.merge(col1);

game.on("game:player:played-all-cards", (_, player) => {
	console.log(player.id + " has played all their cards.");
})

game.on("game:game-winner", (_, winners) => {
	let text = winners.map(player => player.id).join(', ');

	if (winners.length !== 1) {
		text = "The winners are: " + text;
	} else {
		text = "The winner is: " + text;
	}

	console.log(text + "!");
});

game.on("game:tsar:choice", (_, choice) => {
	console.log("The Tsar chose '" + choice[1] + "' which was played by " + choice[0].id + "! They got a point.");
});


game.addPlayer(P2);
game.addPlayer(P3);

game.start();

game.removePlayer(P2);

let P4 = new CAH.Player('Player4');

game.addPlayer(P4);
game.start();

function playTurn () {
	if (game.state === 'ENDGAME') {
		return;
	}

	console.log("Black Card is: ", game.blackCard.toString());

	game.players.forEach(player => {
		if (!game.isTsar(player)) {
			for (let i = 0; i < game.blackCard.getFillCount(); i++) {
				game.play(player, player.cards[i]);
			}
		} else {
			console.log(player.id, "is tsar");
		}
	});


	console.log(game.state);
	console.log(game.getFilledInCardText());

	let chosen = CAH.randomIndex(game.getFilledInCardText().length);

	console.log("Tsar Choosing Winner:", game.chooseTurnWinnerByIndex(game.tsar, chosen));

	console.log(game.players.map(player => player.id + ' ' + player.points).join(', '));

	playTurn();
}